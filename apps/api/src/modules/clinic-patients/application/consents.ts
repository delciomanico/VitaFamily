// Lado família (UC-CLN-15/16, BR-CLN-19/20, authorization.md §6.4, endpoints.md `clinic-consents*`/
// `clinic-link-codes`): só `SELF` adulto ou `TUTOR_OF`, decidido por `AccessPolicy.can(MANAGE_CLINIC_CONSENT)`.
// Auditoria `CLINIC_CONSENT_SET/REVOKE`/`CLINIC_LINK_CODE_CREATE` com `actor_type=USER` e SEM texto nem o código.
import { NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { effectiveConsent, historyValidUntil, parseConsentLevel, type ClinicConsent } from "../domain/consent.js";
import { generateLinkCode, hashLinkCode, LINK_CODE_MEMBER_RULE, LINK_CODE_TTL_MS } from "../domain/link-code.js";
import type { ActorIdentity, ClinicPatientsDeps, RequestContext } from "./ports.js";

export interface ClinicConsentView {
  clinicId: string;
  clinicName: string;
  level: "BOOKINGS" | "HISTORY";
  validUntil: string | null;
  renewalNeeded: boolean;
  linked: boolean;
}

function authorize<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, actor: ActorIdentity, familyId: string, memberId: string) {
  return deps.policy.can(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, action: "MANAGE_CLINIC_CONSENT", subjectMemberId: memberId });
}

function toConsentView(consent: Pick<ClinicConsent, "level" | "historyValidUntil"> | undefined, clinic: { id: string; name: string }, linked: boolean, now: Date): ClinicConsentView {
  const effective = effectiveConsent(consent ?? { level: "BOOKINGS" }, now);
  return { clinicId: clinic.id, clinicName: clinic.name, level: effective.level, validUntil: effective.validUntil?.toISOString() ?? null, renewalNeeded: effective.renewalNeeded, linked };
}

/** `GET …/clinic-consents`: "quem vê o quê" — consentimento e/ou ligação; inclui clínicas arquivadas (revogar é sempre possível). */
export function createListClinicConsentsUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function listClinicConsents(actor: ActorIdentity, familyId: string, memberId: string): Promise<ClinicConsentView[]> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, familyId, memberId);
      const consents = await deps.consentsRepo.listByMember(trx, familyId, memberId);
      const links = await deps.linksRepo.listByMember(trx, familyId, memberId);
      const clinicIds = [...new Set([...consents.map((c) => c.clinicId), ...links.map((l) => l.clinicId)])];
      const now = deps.clock.now();
      const views: ClinicConsentView[] = [];
      for (const clinicId of clinicIds) {
        const clinic = await deps.clinics.findPartnerClinic(trx, clinicId);
        if (!clinic) continue;
        views.push(toConsentView(consents.find((c) => c.clinicId === clinicId), clinic, links.some((l) => l.clinicId === clinicId), now));
      }
      return views.sort((a, b) => a.clinicName.localeCompare(b.clinicName, "pt-PT"));
    });
  };
}

/** `PUT …/clinic-consents/{clinicId}`: efeito imediato e idempotente; `HISTORY` +12 meses (repetir = renovar). */
export function createPutClinicConsentUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function putClinicConsent(actor: ActorIdentity, familyId: string, memberId: string, clinicId: string, input: { level: unknown }, context: RequestContext): Promise<ClinicConsentView> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, familyId, memberId);
      const clinic = await deps.clinics.findPartnerClinic(trx, clinicId);
      if (!clinic?.active) {
        throw new NotFoundError({ detail: "Clínica não encontrada." });
      }
      const level = parseConsentLevel(input.level);
      const now = deps.clock.now();
      const previous = await deps.consentsRepo.find(trx, clinicId, memberId);
      const validUntil = level === "HISTORY" ? historyValidUntil(now) : null;
      await deps.consentsRepo.upsert(trx, { clinicId, familyId, memberId, level, historyValidUntil: validUntil, grantedByUserId: actor.userId, now });
      const link = await deps.linksRepo.findByMember(trx, clinicId, memberId);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CLINIC_CONSENT_SET",
        resourceType: "ClinicConsent",
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { clinicId, level, renewed: level === "HISTORY" && previous?.level === "HISTORY" },
      });
      return toConsentView({ level, ...(validUntil ? { historyValidUntil: validUntil } : {}) }, clinic, link !== null, now);
    });
  };
}

/** `DELETE …/clinic-consents/{clinicId}`: apaga consentimento E ligação; a clínica conserva o seu registo, desligado (BR-CLN-19/24). */
export function createRevokeClinicConsentUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function revokeClinicConsent(actor: ActorIdentity, familyId: string, memberId: string, clinicId: string, context: RequestContext): Promise<void> {
    await deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, familyId, memberId);
      const consentDeleted = await deps.consentsRepo.delete(trx, clinicId, memberId);
      const linkDeleted = await deps.linksRepo.deleteByMember(trx, clinicId, memberId);
      if (!consentDeleted && !linkDeleted) {
        throw new NotFoundError({ detail: "Sem consentimento nem ligação com esta clínica." });
      }
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CLINIC_CONSENT_REVOKE",
        resourceType: "ClinicConsent",
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { clinicId },
      });
    });
  };
}

export interface ClinicLinkCodeView {
  code: string;
  expiresAt: string;
}

/** `POST …/clinic-link-codes` (BR-CLN-20): 8 caracteres, 10 min, uso único; só o HMAC fica guardado; 5/h por membro. */
export function createCreateClinicLinkCodeUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function createClinicLinkCode(actor: ActorIdentity, familyId: string, memberId: string, context: RequestContext): Promise<ClinicLinkCodeView> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, familyId, memberId);
      const now = deps.clock.now();
      const recent = await deps.codesRepo.listCreatedSince(trx, memberId, new Date(now.getTime() - LINK_CODE_MEMBER_RULE.windowMs));
      if (recent.length >= LINK_CODE_MEMBER_RULE.max) {
        const oldest = recent[0] ?? now;
        throw new RateLimitedError(Math.max(0, oldest.getTime() + LINK_CODE_MEMBER_RULE.windowMs - now.getTime()));
      }
      const code = generateLinkCode();
      const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
      await deps.codesRepo.invalidateActive(trx, memberId, now);
      await deps.codesRepo.insert(trx, { id: newId(), familyId, memberId, codeHash: hashLinkCode(deps.linkCodeSecret, code), expiresAt, createdByUserId: actor.userId, createdAt: now });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "CLINIC_LINK_CODE_CREATE",
        resourceType: "ClinicLinkCode",
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      return { code, expiresAt: expiresAt.toISOString() };
    });
  };
}
