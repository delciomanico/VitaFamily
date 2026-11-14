// App do paciente (S6 parcial; openapi listInsuranceCardClaims / claimInsuranceCard / revokeInsuranceCardClaim /
// listInsuranceCards / getInsuranceCardQr / getInsuranceCardCoverage; UC-SEG-14/15, BR-SEG-18/20/23/25, authorization.md §8.5).
// Ator `User`: só `SELF` (adulto) ou `TUTOR_OF` (via `AccessPolicy`, porta `PatientAccessPort`); qualquer recusa ⇒ `NOT_FOUND`
// (contrato: «OTHER ⇒ 404»). Só seguradoras com módulo operacional ativo. Dados da seguradora, nunca de saúde; a única
// fronteira é a ligação consentida e revogável (listar pedidos e desligar valem mesmo com módulo desativado, P-SEG-1). Sem saldo/«usado» (D-A2).
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields, type AuditEvent } from "../../audit/index.js";
import { hashClaimCode } from "../domain/beneficiary.js";
import { CARD_QR_TTL_SECONDS, signCardQrToken } from "../domain/card-qr.js";
import { parseClaimRequest } from "../domain/card-claim.js";
import { evaluateEligibility } from "../domain/coverage.js";
import { coverageLimitsFor, type CoverageLimits } from "../domain/eligibility.js";
import type { LinkRequestStatus } from "../domain/link-request.js";
import { CLAIM_RATE_LIMITS, QR_RATE_LIMIT } from "../domain/rate-limiter.js";
import type { OpsDeps, PatientActor, RequestContext } from "./ports.js";
import { notFound } from "./support.js";

export interface CardClaimView {
  id: string;
  insurerId: string;
  insurerName: string;
  beneficiaryId: string | null;
  status: LinkRequestStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export interface CardView {
  beneficiaryId: string;
  insurerId: string;
  insurerName: string;
  currency: string;
  beneficiaryName: string;
  cardNumber: string;
  status: string;
  planName: string | null;
  policyNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
}

export interface CardCoverageView {
  beneficiaryId: string;
  insurerId: string;
  currency: string;
  status: string;
  planName: string | null;
  policyNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
  coverages: CoverageLimits[];
}

export interface CardQrView {
  token: string;
  expiresAt: Date;
  cardVersion: number;
}

/** §8.5: `MANAGE_INSURANCE`. Recusa (OTHER, dependente, não-membro, Platform Admin) ⇒ `NOT_FOUND`; `MEMBER_BLOCKED` segue como está. */
async function authorizePatient<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: PatientActor, familyId: string, memberId: string): Promise<{ relation: string }> {
  try {
    return await deps.patientAccess.authorize(trx, { actor, familyId, memberId });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) throw notFound();
    throw error;
  }
}

/** Auditoria do paciente (`actor_type=USER`): `familyId`/`subjectMemberId`; `metadata` nunca com código, apólice, cartão ou token. */
function patientAudit<Trx>(
  deps: OpsDeps<Trx>,
  actor: PatientActor,
  familyId: string,
  memberId: string,
  context: RequestContext,
  event: Pick<AuditEvent, "action" | "resourceType"> & { resourceId?: string; result?: AuditEvent["result"]; metadata: Record<string, string | number | boolean | null> },
): AuditEvent {
  const { metadata, result, ...rest } = event;
  return { occurredAt: deps.clock.now(), actorType: "USER", actorUserId: actor.userId, familyId, subjectMemberId: memberId, result: result ?? "SUCCESS", requestId: context.requestId, ...auditContextFields(context), ...rest, metadata };
}

/** Seguradora acessível ao paciente: módulo operacional ativo (e, para reclamar, seguradora `ACTIVE`). */
async function insurerFor<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, requireActive: boolean) {
  const settings = await deps.insurers.get(trx, insurerId);
  if (!settings?.operationalModuleEnabled || (requireActive && settings.status !== "ACTIVE")) return null;
  return settings;
}

const today = (deps: { clock: { now(): Date } }): string => deps.clock.now().toISOString().slice(0, 10);

export function createListCardClaimsUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listCardClaims(actor: PatientActor, familyId: string, memberId: string): Promise<CardClaimView[]> {
    return deps.withTransaction(async (trx) => {
      await authorizePatient(deps, trx, actor, familyId, memberId);
      const views: CardClaimView[] = [];
      for (const r of await deps.patients.listRequests(trx, familyId, memberId)) {
        // P-SEG-1: pedidos próprios listam-se sempre (sem exigir módulo ativo); só o nome (contrato) sai da seguradora.
        const insurer = await deps.insurers.get(trx, r.insurerId);
        if (!insurer) continue;
        views.push({ id: r.id, insurerId: r.insurerId, insurerName: insurer.name, beneficiaryId: r.beneficiaryId, status: r.status, requestedAt: r.createdAt, decidedAt: r.decidedAt, decisionNote: r.decisionNote });
      }
      return views; // mais recentes primeiro (ordem do repositório)
    });
  };
}

/**
 * BR-SEG-20/25: apólice + código ⇒ pedido `PENDING`. Apólice/código inexistentes, errados, expirados, de beneficiário já
 * ligado/cancelado ou de seguradora indisponível ⇒ o MESMO `NOT_FOUND` (uma só consulta, o mesmo trabalho). O código é de uso único.
 * Rate limit por utilizador e por IP; cada tentativa conta.
 */
export function createClaimCardUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function claimCard(actor: PatientActor, familyId: string, memberId: string, input: Record<string, unknown>, context: RequestContext): Promise<CardClaimView> {
    const request = parseClaimRequest(input);
    const outcome = await deps.withTransaction(async (trx): Promise<{ limitedMs: number } | { claim: CardClaimView }> => {
      await authorizePatient(deps, trx, actor, familyId, memberId);

      const userKey = `claim:user:${actor.userId}`;
      const ipKey = context.ip === undefined ? null : `claim:ip:${context.ip}`;
      const byUser = deps.rateLimiter.peek(userKey, CLAIM_RATE_LIMITS.user);
      const byIp = ipKey === null ? { allowed: true, retryAfterMs: 0 } : deps.rateLimiter.peek(ipKey, CLAIM_RATE_LIMITS.ip);
      if (!byUser.allowed || !byIp.allowed) {
        const blocked: [string, number][] = [];
        if (!byUser.allowed) blocked.push([userKey, CLAIM_RATE_LIMITS.user.windowMs]);
        if (ipKey !== null && !byIp.allowed) blocked.push([ipKey, CLAIM_RATE_LIMITS.ip.windowMs]);
        // No máximo 1 registo por chave e janela (não inflar `audit_logs`).
        const fresh = blocked.map(([key, windowMs]) => deps.rateLimiter.shouldAuditDenial(key, windowMs));
        if (fresh.some(Boolean)) await deps.audit.record(trx, patientAudit(deps, actor, familyId, memberId, context, { action: "INSURER_LINK_REQUEST", resourceType: "InsurerLinkRequest", result: "DENIED", metadata: { step: "CLAIM", reason: "RATE_LIMITED" } }));
        return { limitedMs: Math.max(byUser.retryAfterMs, byIp.retryAfterMs) };
      }
      deps.rateLimiter.record(userKey, CLAIM_RATE_LIMITS.user);
      if (ipKey !== null) deps.rateLimiter.record(ipKey, CLAIM_RATE_LIMITS.ip);

      const now = deps.clock.now();
      const candidate = await deps.patients.findClaimCandidate(trx, request.insurerId, request.policyNumber, hashClaimCode(deps.claimCodeSecret, request.code), now);
      const insurer = await insurerFor(deps, trx, request.insurerId, true);
      // Estado do próprio membro (não revela nada de terceiros): já tem pedido pendente ou ligação nesta seguradora. A consulta
      // corre sempre, haja ou não seguradora/candidato, para que as recusas façam o mesmo trabalho na BD (anti-timing).
      const pendingOrLinked = await deps.patients.hasPendingOrLinked(trx, request.insurerId, familyId, memberId);
      if (insurer && pendingOrLinked) {
        throw new ConflictError({ detail: "Já existe um pedido pendente ou uma ligação a esta seguradora." });
      }
      if (!candidate || !insurer) throw notFound();

      await deps.patients.consumeClaimCode(trx, request.insurerId, candidate.beneficiaryId, now);
      const id = newId();
      await deps.patients.insertRequest(trx, { id, insurerId: request.insurerId, beneficiaryId: candidate.beneficiaryId, requestedBy: actor.userId, familyId, memberId, createdAt: now });
      await deps.audit.record(trx, patientAudit(deps, actor, familyId, memberId, context, { action: "INSURER_LINK_REQUEST", resourceType: "InsurerLinkRequest", resourceId: id, metadata: { insurerId: request.insurerId, step: "CLAIM" } }));
      return { claim: { id, insurerId: request.insurerId, insurerName: insurer.name, beneficiaryId: null, status: "PENDING", requestedAt: now, decidedAt: null, decisionNote: null } };
    });
    if ("limitedMs" in outcome) throw new RateLimitedError(outcome.limitedMs, { detail: "Demasiadas tentativas. Tente novamente mais tarde." });
    return outcome.claim;
  };
}

/** BR-SEG-20: `CONFIRMED → REVOKED` a qualquer momento; o beneficiário mantém-se, só a ligação desfaz-se. Outro estado ⇒ `CONFLICT`. */
export function createRevokeCardClaimUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function revokeCardClaim(actor: PatientActor, familyId: string, memberId: string, claimId: string, context: RequestContext): Promise<void> {
    await deps.withTransaction(async (trx) => {
      await authorizePatient(deps, trx, actor, familyId, memberId);
      const found = await deps.patients.findRequest(trx, familyId, memberId, claimId, true);
      // P-SEG-1: desligar não depende do módulo operacional nem do estado da seguradora (a revogação do consentimento é sempre possível).
      if (!found) throw notFound();
      if (found.status !== "CONFIRMED" || found.beneficiaryId === null) throw new ConflictError({ detail: "Só é possível desligar uma ligação confirmada." });
      await deps.patients.revoke(trx, { insurerId: found.insurerId, requestId: found.id, beneficiaryId: found.beneficiaryId, familyId, memberId, now: deps.clock.now() });
      await deps.audit.record(trx, patientAudit(deps, actor, familyId, memberId, context, { action: "INSURER_LINK_REVOKE", resourceType: "InsurerLinkRequest", resourceId: found.id, metadata: { insurerId: found.insurerId } }));
    });
  };
}

export function createListCardsUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listCards(actor: PatientActor, familyId: string, memberId: string): Promise<CardView[]> {
    return deps.withTransaction(async (trx) => {
      await authorizePatient(deps, trx, actor, familyId, memberId);
      const day = today(deps);
      const cards: CardView[] = [];
      for (const link of await deps.patients.listLinked(trx, familyId, memberId)) {
        const insurer = await insurerFor(deps, trx, link.insurerId, false);
        const candidate = insurer ? await deps.eligibility.find(trx, link.insurerId, { kind: "ID", beneficiaryId: link.beneficiaryId }, day) : null;
        if (!insurer || !candidate) continue;
        cards.push({
          beneficiaryId: link.beneficiaryId,
          insurerId: link.insurerId,
          insurerName: insurer.name,
          currency: insurer.currency,
          beneficiaryName: candidate.name,
          cardNumber: candidate.cardNumber,
          status: candidate.status,
          planName: candidate.policy?.planName ?? null,
          policyNumber: candidate.policy?.number ?? null,
          validFrom: candidate.policy?.validFrom ?? null,
          validTo: candidate.policy?.validTo ?? null,
        });
      }
      // BR-SEG-23: um cartão por seguradora, independentes (sem somas).
      return cards.sort((a, b) => a.insurerName.localeCompare(b.insurerName) || a.insurerId.localeCompare(b.insurerId));
    });
  };
}

/** UC-SEG-15/BR-SEG-18: token assinado de validade curta (120 s) e revogável (`cardVersion`); cada pedido emite um novo. */
export function createIssueCardQrUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function issueCardQr(actor: PatientActor, familyId: string, memberId: string, beneficiaryId: string, context: RequestContext): Promise<CardQrView> {
    const outcome = await deps.withTransaction(async (trx): Promise<{ limitedMs: number } | { qr: CardQrView }> => {
      await authorizePatient(deps, trx, actor, familyId, memberId);
      const link = await deps.patients.findLinked(trx, familyId, memberId, beneficiaryId);
      const insurer = link ? await insurerFor(deps, trx, link.insurerId, false) : null;
      const candidate = link && insurer ? await deps.eligibility.find(trx, link.insurerId, { kind: "ID", beneficiaryId }, today(deps)) : null;
      if (!link || !insurer || !candidate) throw notFound();

      const key = `qr:${actor.userId}:${beneficiaryId}`;
      const limit = deps.rateLimiter.peek(key, QR_RATE_LIMIT);
      if (!limit.allowed) {
        // No máximo 1 registo por chave e janela (não inflar `audit_logs`).
        if (deps.rateLimiter.shouldAuditDenial(key, QR_RATE_LIMIT.windowMs)) {
          await deps.audit.record(trx, patientAudit(deps, actor, familyId, memberId, context, { action: "CARD_QR_ISSUE", resourceType: "InsurerBeneficiary", resourceId: beneficiaryId, result: "DENIED", metadata: { insurerId: link.insurerId, reason: "RATE_LIMITED" } }));
        }
        return { limitedMs: limit.retryAfterMs };
      }
      deps.rateLimiter.record(key, QR_RATE_LIMIT);

      const expiresAtSeconds = Math.floor(deps.clock.now().getTime() / 1000) + CARD_QR_TTL_SECONDS;
      const token = signCardQrToken(deps.claimCodeSecret, { insurerId: link.insurerId, beneficiaryId, cardVersion: candidate.cardVersion, expiresAt: expiresAtSeconds });
      await deps.audit.record(trx, patientAudit(deps, actor, familyId, memberId, context, { action: "CARD_QR_ISSUE", resourceType: "InsurerBeneficiary", resourceId: beneficiaryId, metadata: { insurerId: link.insurerId } }));
      return { qr: { token, expiresAt: new Date(expiresAtSeconds * 1000), cardVersion: candidate.cardVersion } };
    });
    if ("limitedMs" in outcome) throw new RateLimitedError(outcome.limitedMs, { detail: "Demasiados pedidos de QR. Tente novamente mais tarde." });
    return outcome.qr;
  };
}

/**
 * UC-SEG-14 (Fase A, D-A2): só cobertura e limites; nunca «usado»/«reservado»/saldo. Beneficiário não `ACTIVE` ⇒ sem serviços
 * listados (o estado explica). `COVERAGE_VIEW` quando lido por quem não é o próprio titular (tutor).
 */
export function createGetCardCoverageUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function getCardCoverage(actor: PatientActor, familyId: string, memberId: string, beneficiaryId: string, context: RequestContext): Promise<CardCoverageView> {
    return deps.withTransaction(async (trx) => {
      const access = await authorizePatient(deps, trx, actor, familyId, memberId);
      const link = await deps.patients.findLinked(trx, familyId, memberId, beneficiaryId);
      const insurer = link ? await insurerFor(deps, trx, link.insurerId, false) : null;
      const day = today(deps);
      const candidate = link && insurer ? await deps.eligibility.find(trx, link.insurerId, { kind: "ID", beneficiaryId }, day) : null;
      if (!link || !insurer || !candidate) throw notFound();

      const { policy } = candidate;
      const rows = policy && evaluateEligibility({ status: candidate.status, policy }, day).eligible ? await deps.eligibility.coverages(trx, link.insurerId, policy.planId, null) : [];
      if (access.relation !== "SELF") {
        await deps.audit.record(trx, patientAudit(deps, actor, familyId, memberId, context, { action: "COVERAGE_VIEW", resourceType: "InsurerBeneficiary", resourceId: beneficiaryId, metadata: { insurerId: link.insurerId } }));
      }
      return {
        beneficiaryId,
        insurerId: link.insurerId,
        currency: insurer.currency,
        status: candidate.status,
        planName: policy?.planName ?? null,
        policyNumber: policy?.number ?? null,
        validFrom: policy?.validFrom ?? null,
        validTo: policy?.validTo ?? null,
        coverages: policy ? coverageLimitsFor(rows, { status: candidate.status, policy }, day) : [],
      };
    });
  };
}

