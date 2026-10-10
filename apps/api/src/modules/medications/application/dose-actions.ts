// Ações sobre uma toma (UC-MED-05/06/07): confirmar, marcar "não tomada", corrigir. Partilham a
// resolução da toma + janela (`domain/dose-occurrence.ts`) + autorização `CONFIRM_DOSE`
// (authorization.md §3: titular, tutor ou dependente com conta — nunca `OTHER`, mesmo com
// partilha, BR-MED-05).
import { DomainError, ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import { canActOnDose, canCorrectDose, type DoseOccurrence, type DoseStatus } from "../domain/dose-occurrence.js";
import type { ActorIdentity, MedicationsDeps, RequestContext } from "./ports.js";

export async function resolveDoseForAction<Trx>(
  deps: MedicationsDeps<Trx>,
  trx: Trx,
  actor: ActorIdentity,
  familyId: string,
  memberId: string,
  doseId: string,
): Promise<DoseOccurrence> {
  await deps.policy.can(trx, {
    userId: actor.userId,
    platformAdmin: actor.platformAdmin,
    familyId,
    action: "CONFIRM_DOSE",
    subjectMemberId: memberId,
    category: "MEDICATION",
  });

  const dose = await deps.dosesRepo.findById(trx, familyId, memberId, doseId);
  if (!dose) {
    throw new NotFoundError({ detail: "Toma não encontrada." });
  }
  return dose;
}

export async function applyDoseAction<Trx>(
  deps: MedicationsDeps<Trx>,
  trx: Trx,
  actor: ActorIdentity,
  familyId: string,
  memberId: string,
  doseId: string,
  targetStatus: "TAKEN" | "NOT_TAKEN",
  note: string | null | undefined,
  context: RequestContext,
  auditAction: AuditAction,
): Promise<DoseOccurrence> {
  const dose = await resolveDoseForAction(deps, trx, actor, familyId, memberId, doseId);
  const now = deps.clock.now();

  // Idempotente (D7, Q2): já no estado pedido -> devolve sem reescrever `actedAt`/`actedByUserId`.
  if (dose.status === targetStatus) {
    return dose;
  }

  if (dose.status === "TAKEN" || dose.status === "NOT_TAKEN") {
    // Já houve uma ação diferente (TAKEN<->NOT_TAKEN) — isto é uma CORREÇÃO (ST2/UC-MED-07), não a
    // ação inicial; esta função só cobre PENDING/UNCONFIRMED -> TAKEN/NOT_TAKEN.
    throw new DomainError("CONFLICT", { detail: "Toma já registada; use a correção." });
  }

  const timeZone = await deps.timezone.getEffectiveTimezone(trx, familyId, memberId);
  const decision = canActOnDose(dose.scheduledAt, now, timeZone);
  if (!decision.allowed) {
    throw new DomainError(decision.reason, { detail: "Fora da janela de ação sobre a toma." });
  }

  const updated = await deps.dosesRepo.updateStatus(trx, doseId, targetStatus, now, actor.userId, note ?? null);

  await deps.audit.record(trx, {
    occurredAt: now,
    actorType: "USER",
    actorUserId: actor.userId,
    action: auditAction,
    resourceType: "DoseOccurrence",
    resourceId: doseId,
    familyId,
    subjectMemberId: memberId,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
  });

  return updated;
}

export async function applyDoseCorrection<Trx>(
  deps: MedicationsDeps<Trx>,
  trx: Trx,
  actor: ActorIdentity,
  familyId: string,
  memberId: string,
  doseId: string,
  targetStatus: DoseStatus,
  note: string | null | undefined,
  context: RequestContext,
): Promise<DoseOccurrence> {
  const callerContext = await deps.policy.can(trx, {
    userId: actor.userId,
    platformAdmin: actor.platformAdmin,
    familyId,
    action: "CONFIRM_DOSE",
    subjectMemberId: memberId,
    category: "MEDICATION",
  });

  const dose = await deps.dosesRepo.findById(trx, familyId, memberId, doseId);
  if (!dose) {
    throw new NotFoundError({ detail: "Toma não encontrada." });
  }

  // UC-MED-07: "quem confirmou, o titular ou o tutor" — SELF/TUTOR_OF sempre podem corrigir;
  // DEPENDENT_SELF só a sua própria ação anterior (authorization.md §3: nunca escrita geral).
  if (callerContext.relation === "DEPENDENT_SELF" && dose.actedByUserId !== actor.userId) {
    throw new ForbiddenError({ detail: "Só quem registou a toma (ou o titular/tutor) a pode corrigir." });
  }

  if (dose.status !== "TAKEN" && dose.status !== "NOT_TAKEN") {
    throw new DomainError("CONFLICT", { detail: "Só é possível corrigir uma toma já registada (confirmada ou não tomada)." });
  }
  if (dose.status === targetStatus) {
    return dose;
  }

  const now = deps.clock.now();
  const decision = canCorrectDose(dose.scheduledAt, now);
  if (!decision.allowed) {
    throw new DomainError(decision.reason, { detail: "Fora da janela de correção da toma (7 dias)." });
  }

  const updated = await deps.dosesRepo.updateStatus(trx, doseId, targetStatus, now, actor.userId, note ?? null);

  await deps.audit.record(trx, {
    occurredAt: now,
    actorType: "USER",
    actorUserId: actor.userId,
    action: "DOSE_CORRECTED",
    resourceType: "DoseOccurrence",
    resourceId: doseId,
    familyId,
    subjectMemberId: memberId,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
  });

  return updated;
}
