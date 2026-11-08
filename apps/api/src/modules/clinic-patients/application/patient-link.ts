// Ligar um paciente Vita com o código/QR (UC-CLN-15, BR-CLN-20/19/10, endpoints.md `POST /clinic-portal/patients/link`).
// 404 idêntico para código inexistente/expirado/usado e `clinicPatientId` de outra clínica; rate limit
// partilhado com o walk-in (chaves `walk-in:*`); auditoria sem o código, falhas como `FAILURE` sem sujeito.
import { ConflictError, NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { buildPatientDisplayName } from "../domain/display-name.js";
import { hashLinkCode, normalizeLinkCode } from "../domain/link-code.js";
import { normalizeSearchText } from "../domain/clinic-patient.js";
import { LINK_ACCOUNT_RULE, LINK_IP_RULE, LINK_NOT_FOUND_RULE } from "../domain/rate-limiter.js";
import type { ClinicPatientsDeps, ClinicPortalActor, RequestContext } from "./ports.js";
import { toPatientView, type ClinicPatientView } from "./support.js";

const NOT_FOUND_DETAIL = "Código inválido, expirado ou já utilizado.";

export interface LinkClinicPatientInput {
  code: unknown;
  clinicPatientId?: string | null | undefined;
}

async function enforceLinkRateLimit<Trx>(deps: ClinicPatientsDeps<Trx>, actor: ClinicPortalActor, context: RequestContext): Promise<void> {
  const ip = deps.sharedLimiter.consume(`walk-in:ip:${context.ip ?? "unknown"}`, LINK_IP_RULE);
  const account = deps.sharedLimiter.consume(`walk-in:account:${actor.clinicAccountId}`, LINK_ACCOUNT_RULE);
  const failures = deps.sharedLimiter.peek(`walk-in:404:${actor.clinicAccountId}`, LINK_NOT_FOUND_RULE);
  const blocked = [ip, account, failures].find((decision) => !decision.allowed);
  if (!blocked) return;
  await deps.withTransaction(async (trx) => {
    await deps.audit.record(trx, {
      occurredAt: deps.clock.now(),
      actorType: "CLINIC_ACCOUNT",
      actorClinicAccountId: actor.clinicAccountId,
      action: "CLINIC_PATIENT_LINK",
      resourceType: "ClinicPatient",
      result: "DENIED",
      requestId: context.requestId,
      ...auditContextFields(context),
      metadata: { reason: "RATE_LIMITED" },
    });
  });
  throw new RateLimitedError(Math.max(ip.retryAfterMs, account.retryAfterMs, failures.retryAfterMs));
}

type LinkOutcome = { kind: "FOUND"; view: ClinicPatientView } | { kind: "NOT_FOUND" };

export function createLinkClinicPatientUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function linkClinicPatient(actor: ClinicPortalActor, input: LinkClinicPatientInput, context: RequestContext): Promise<ClinicPatientView> {
    const code = normalizeLinkCode(input.code);
    await enforceLinkRateLimit(deps, actor, context);

    const outcome = await deps.withTransaction<LinkOutcome>(async (trx) => {
      const now = deps.clock.now();
      const failure = async (): Promise<LinkOutcome> => {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "CLINIC_ACCOUNT",
          actorClinicAccountId: actor.clinicAccountId,
          action: "CLINIC_PATIENT_LINK",
          resourceType: "ClinicPatient",
          result: "FAILURE",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
        return { kind: "NOT_FOUND" };
      };

      // 1. Paciente indicado (de outra clínica/inexistente => o mesmo 404 do código inválido; antes de consumir o código).
      const requested = input.clinicPatientId ? await deps.patientsRepo.findById(trx, actor.clinicId, input.clinicPatientId) : null;
      if (input.clinicPatientId && !requested) return failure();

      // 2. Consumo atómico do código (1 só vence sob concorrência).
      const consumed = await deps.codesRepo.consume(trx, hashLinkCode(deps.linkCodeSecret, code), now);
      if (!consumed) return failure();
      const { familyId, memberId } = consumed;

      // 3. Ligações existentes (conflitos revertem tudo, inclusive o consumo do código).
      const memberLink = await deps.linksRepo.findByMember(trx, actor.clinicId, memberId);
      let created = false;
      let patientId: string;
      if (memberLink) {
        if (requested && requested.id !== memberLink.clinicPatientId) {
          throw new ConflictError({ detail: "O membro já está ligado a outro paciente desta clínica." });
        }
        patientId = memberLink.clinicPatientId; // idempotente: o código fica consumido
      } else {
        if (requested) {
          if (await deps.linksRepo.findByPatient(trx, actor.clinicId, requested.id)) {
            throw new ConflictError({ detail: "O paciente já está ligado a outra pessoa." });
          }
          patientId = requested.id;
        } else {
          const fullName = (await deps.members.getMemberName(trx, familyId, memberId)) ?? "";
          const name = buildPatientDisplayName(fullName) || "Paciente Vita";
          const patient = await deps.patientsRepo.insert(trx, {
            id: newId(),
            clinicId: actor.clinicId,
            name,
            nameNorm: normalizeSearchText(name),
            phone: null,
            phoneDigits: null,
            email: null,
            birthDate: null,
            notes: null,
            origin: "VITA",
            createdByClinicAccountId: actor.clinicAccountId,
            createdAt: now,
          });
          patientId = patient.id;
          created = true;
        }
        await deps.linksRepo.insert(trx, { clinicId: actor.clinicId, clinicPatientId: patientId, familyId, memberId, via: "CODE" });
      }
      // BR-CLN-19: `BOOKINGS` implícito, sem nunca baixar um `HISTORY` existente.
      await deps.consentsRepo.insertBookingsIfMissing(trx, actor.clinicId, familyId, memberId, now);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "CLINIC_PATIENT_LINK",
        resourceType: "ClinicPatient",
        resourceId: patientId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { via: "CODE", created },
      });
      const patient = await deps.patientsRepo.findById(trx, actor.clinicId, patientId);
      if (!patient) throw new NotFoundError({ detail: "Paciente não encontrado." });
      return { kind: "FOUND", view: await toPatientView(deps, trx, actor.clinicId, patient) };
    });

    if (outcome.kind === "NOT_FOUND") {
      deps.sharedLimiter.consume(`walk-in:404:${actor.clinicAccountId}`, LINK_NOT_FOUND_RULE);
      throw new NotFoundError({ detail: NOT_FOUND_DETAIL });
    }
    return outcome.view;
  };
}
