// openapi listClinicInsurers / checkInsurerEligibility / listClinicInsurerServices (UC-SEG-05, BR-SEG-01/02/04/18/22/23,
// authorization.md §8.4). Ator `ClinicAccount` (token da clínica; nunca `AccessPolicy`): CLINIC_ADMIN e CLINIC_MANAGER; o Médico
// ⇒ FORBIDDEN. A clínica só opera em seguradoras a que está ligada (insurer_providers ativo) e com módulo ativo; senão NOT_FOUND.
import { NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import type { Page } from "../../../platform/page/index.js";
import { auditContextFields, type AuditEvent } from "../../audit/index.js";
import { assertClinicRole, type ClinicOpsActor } from "../domain/access.js";
import { verifyCardQrToken } from "../domain/card-qr.js";
import { evaluateEligibility } from "../domain/coverage.js";
import {
  ELIGIBILITY_NOTICE,
  NOT_ELIGIBLE_RESULT,
  parseEligibilityRequest,
  coverageLimitsFor,
  type EligibilityResult,
} from "../domain/eligibility.js";
import { ELIGIBILITY_RATE_LIMITS } from "../domain/rate-limiter.js";
import type { InsurerService } from "../domain/service.js";
import type { EligibilityLookup, OpsDeps, RequestContext } from "./ports.js";
import { toPage, toPageQuery, type PageInput } from "./support.js";

/** Id que nunca existe (`gen_random_uuid()` não o produz): consulta «de enchimento» para igualar o trabalho (BR-SEG-18). */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export interface ClinicInsurer {
  id: string;
  name: string;
  currency: string;
}

/** §8.4 (b): ligação ATIVA da clínica à seguradora + módulo ativo + seguradora ativa; senão `NOT_FOUND` (sem enumeração). */
async function authorizeClinic<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: ClinicOpsActor, insurerId: string): Promise<{ currency: string }> {
  assertClinicRole(actor.role);
  const linked = await deps.providers.isActivelyLinked(trx, actor.clinicId, insurerId);
  const settings = await deps.insurers.get(trx, insurerId);
  if (!linked || !settings || !settings.operationalModuleEnabled || settings.status !== "ACTIVE") {
    throw new NotFoundError({ detail: "Recurso não encontrado." });
  }
  return { currency: settings.currency };
}

export function createListClinicInsurersUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listClinicInsurers(actor: ClinicOpsActor): Promise<ClinicInsurer[]> {
    assertClinicRole(actor.role);
    return deps.withTransaction(async (trx) => {
      const result: ClinicInsurer[] = [];
      for (const insurerId of await deps.providers.activeInsurerIdsOfClinic(trx, actor.clinicId)) {
        const settings = await deps.insurers.get(trx, insurerId);
        if (settings?.operationalModuleEnabled === true && settings.status === "ACTIVE") result.push({ id: insurerId, name: settings.name, currency: settings.currency });
      }
      return result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    });
  };
}

function clinicAudit<Trx>(
  deps: OpsDeps<Trx>,
  actor: ClinicOpsActor,
  insurerId: string,
  context: RequestContext,
  result: AuditEvent["result"],
  metadata: Record<string, string | number | boolean | null>,
): AuditEvent {
  return {
    occurredAt: deps.clock.now(),
    actorType: "CLINIC_ACCOUNT",
    actorClinicAccountId: actor.clinicAccountId,
    actorClinicId: actor.clinicId,
    action: "ELIGIBILITY_CHECK",
    resourceType: "Insurer",
    resourceId: insurerId,
    result,
    requestId: context.requestId,
    ...auditContextFields(context),
    // BR-SEG-15/18: nunca o nº de cartão, QR, documento nem o nome pesquisados; `insurerId` sempre.
    metadata: { insurerId, ...metadata },
  };
}

export function createCheckEligibilityUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function checkEligibility(actor: ClinicOpsActor, insurerId: string, input: Record<string, unknown>, context: RequestContext): Promise<EligibilityResult> {
    assertClinicRole(actor.role);
    const request = parseEligibilityRequest(input);
    const outcome = await deps.withTransaction(async (trx): Promise<{ limitedMs: number } | { result: EligibilityResult }> => {
      const { currency } = await authorizeClinic(deps, trx, actor, insurerId);
      const now = deps.clock.now();
      const today = now.toISOString().slice(0, 10);

      // BR-SEG-18: rate limit por conta de clínica e por IP; cada validação conta (também `eligible:false`).
      const accountKey = `eligibility:account:${actor.clinicAccountId}`;
      const ipKey = context.ip === undefined ? null : `eligibility:ip:${context.ip}`;
      const byAccount = deps.rateLimiter.peek(accountKey, ELIGIBILITY_RATE_LIMITS.account);
      const byIp = ipKey === null ? { allowed: true, retryAfterMs: 0 } : deps.rateLimiter.peek(ipKey, ELIGIBILITY_RATE_LIMITS.ip);
      if (!byAccount.allowed || !byIp.allowed) {
        // No máximo 1 registo por chave e janela (não inflar `audit_logs`).
        const blocked: [string, number][] = [];
        if (!byAccount.allowed) blocked.push([accountKey, ELIGIBILITY_RATE_LIMITS.account.windowMs]);
        if (ipKey !== null && !byIp.allowed) blocked.push([ipKey, ELIGIBILITY_RATE_LIMITS.ip.windowMs]);
        const fresh = blocked.map(([key, windowMs]) => deps.rateLimiter.shouldAuditDenial(key, windowMs));
        if (fresh.some(Boolean)) await deps.audit.record(trx, clinicAudit(deps, actor, insurerId, context, "DENIED", { reason: "RATE_LIMITED" }));
        return { limitedMs: Math.max(byAccount.retryAfterMs, byIp.retryAfterMs) };
      }
      deps.rateLimiter.record(accountKey, ELIGIBILITY_RATE_LIMITS.account);
      if (ipKey !== null) deps.rateLimiter.record(ipKey, ELIGIBILITY_RATE_LIMITS.ip);

      let lookup: EligibilityLookup | null = null;
      let qrCardVersion: number | null = null;
      if (request.by.kind === "CARD") lookup = { kind: "CARD", cardNumber: request.by.cardNumber };
      else if (request.by.kind === "DOCUMENT") lookup = { kind: "DOCUMENT", type: request.by.type, number: request.by.number };
      else {
        // QR inválido/expirado/de outra seguradora ⇒ a mesma resposta «não elegível» (BR-SEG-18).
        const claims = verifyCardQrToken(deps.claimCodeSecret, request.by.token, now);
        if (claims?.insurerId === insurerId) {
          lookup = { kind: "ID", beneficiaryId: claims.beneficiaryId };
          qrCardVersion = claims.cardVersion;
        }
      }

      // Anti-timing: um QR inválido/expirado/de outra seguradora faz a mesma consulta (a um id nulo, que nunca existe).
      const candidate = await deps.eligibility.find(trx, insurerId, lookup ?? { kind: "ID", beneficiaryId: NIL_UUID }, today);
      const revoked = candidate !== null && qrCardVersion !== null && candidate.cardVersion !== qrCardVersion;
      let result: EligibilityResult = NOT_ELIGIBLE_RESULT;
      if (candidate && !revoked && candidate.policy && evaluateEligibility({ status: candidate.status, policy: candidate.policy }, today).eligible) {
        const { policy } = candidate;
        const rows = await deps.eligibility.coverages(trx, insurerId, policy.planId, request.serviceCode);
        result = {
          eligible: true,
          notice: ELIGIBILITY_NOTICE,
          beneficiaryName: candidate.name,
          status: "ACTIVE",
          planName: policy.planName,
          validFrom: policy.validFrom,
          validTo: policy.validTo,
          currency,
          coverages: coverageLimitsFor(rows, { status: candidate.status, policy }, today),
        };
      }

      // `serviceCode` só entra na auditoria se for um código real da lista da seguradora (nunca texto livre da clínica).
      const knownService = request.serviceCode !== null && (await deps.eligibility.serviceCodeExists(trx, insurerId, request.serviceCode));
      await deps.audit.record(
        trx,
        clinicAudit(deps, actor, insurerId, context, "SUCCESS", {
          result: result.eligible ? "ELIGIBLE" : "NOT_ELIGIBLE",
          ...(knownService && request.serviceCode !== null ? { serviceCode: request.serviceCode } : {}),
        }),
      );
      return { result };
    });
    if ("limitedMs" in outcome) throw new RateLimitedError(outcome.limitedMs, { detail: "Demasiadas validações. Tente novamente mais tarde." });
    return outcome.result;
  };
}

export function createListClinicInsurerServicesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listClinicInsurerServices(actor: ClinicOpsActor, insurerId: string, query: PageInput & { q?: string | undefined }): Promise<Page<InsurerService>> {
    assertClinicRole(actor.role);
    const page = toPageQuery(query);
    return deps.withTransaction(async (trx) => {
      await authorizeClinic(deps, trx, actor, insurerId);
      const rows = await deps.services.list(trx, insurerId, { status: "ACTIVE", ...(query.q ? { q: query.q } : {}) }, page);
      return toPage(rows, page, (s) => s);
    });
  };
}

