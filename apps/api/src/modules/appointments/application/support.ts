// Helpers partilhados pelos casos de uso (audit.md §3: "sim qualquer leitura por quem não é o
// titular" — mesmo critério de `prescriptions`/`medications` `application/support.ts`) e a
// resolução da clínica selecionada (BR-APT-04/BR-CLN-02).
import type { AccessContext } from "../../access/index.js";
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import { ValidationError } from "../../../platform/errors/index.js";
import type { AppointmentsDeps, RequestContext } from "./ports.js";

export async function auditViewIfNotSelf<Trx>(
  deps: AppointmentsDeps<Trx>,
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
    resourceType: "Appointment",
    resourceId: params.memberId,
    familyId: params.familyId,
    subjectMemberId: params.memberId,
    result: "SUCCESS",
    requestId: params.context.requestId,
    ...auditContextFields(params.context),
  });
}

/**
 * Resolve a clínica selecionada (BR-APT-04): se `clinicId` for indicado, tem de existir, estar
 * ACTIVE e (se PRIVATE) ser da família do pedido (`clinics.getBookableClinic`,
 * state-machines.md "Clinic": "Arquivada: não selecionável em novas marcações") — o nome
 * devolvido substitui sempre qualquer `clinicName` enviado pelo cliente (congela o nome atual,
 * BR-CLN-02). Sem `clinicId`: `clinicName` é texto livre ("entrada privada" ad hoc, sem
 * `Clinic` próprio) ou ambos ausentes ("nenhuma").
 */
export async function resolveClinicSnapshot<Trx>(
  deps: AppointmentsDeps<Trx>,
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
