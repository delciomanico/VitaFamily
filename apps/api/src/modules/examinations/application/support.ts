// Helpers partilhados pelos casos de uso: auditoria de leitura por quem não é o titular
// (audit.md §3, mesmo critério de `prescriptions`/`appointments` `application/support.ts`) e a
// resolução da clínica selecionada (BR-CLN-02), idêntica à de `appointments`.
import { ValidationError } from "../../../platform/errors/index.js";
import type { AccessContext } from "../../access/index.js";
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import type { ExaminationsDeps, RequestContext } from "./ports.js";

export async function auditViewIfNotSelf<Trx>(
  deps: ExaminationsDeps<Trx>,
  trx: Trx,
  ctx: AccessContext,
  params: { userId: string; familyId: string; memberId: string; context: RequestContext },
): Promise<void> {
  if (ctx.relation === "SELF") {
    return;
  }
  const action: AuditAction = "HEALTH_VIEW";
  await deps.audit.record(trx, {
    occurredAt: deps.clock.now(),
    actorType: "USER",
    actorUserId: params.userId,
    action,
    resourceType: "Examination",
    resourceId: params.memberId,
    familyId: params.familyId,
    subjectMemberId: params.memberId,
    result: "SUCCESS",
    requestId: params.context.requestId,
    ...auditContextFields(params.context),
  });
}

/** Mesmo critério de `appointments/application/support.ts` (BR-APT-04/BR-CLN-02, aqui para exames). */
export async function resolveClinicSnapshot<Trx>(
  deps: ExaminationsDeps<Trx>,
  trx: Trx,
  familyId: string,
  clinicId: string | null | undefined,
  clinicName: string | null | undefined,
): Promise<{ clinicId?: string; clinicName?: string }> {
  if (clinicId === undefined) {
    return clinicName === undefined ? {} : { ...(clinicName ? { clinicName } : {}) };
  }
  if (clinicId === null) {
    return { ...(clinicName ? { clinicName } : {}) };
  }
  const clinic = await deps.clinics.getBookableClinic(trx, familyId, clinicId);
  if (!clinic) {
    throw new ValidationError([{ field: "clinicId", message: "clínica inválida, arquivada ou de outra família" }], { detail: "Clínica inválida." });
  }
  return { clinicId: clinic.id, clinicName: clinic.name };
}
