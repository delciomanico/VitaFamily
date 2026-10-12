// Helpers partilhados pelos casos de uso (audit.md §3: "sim qualquer leitura por quem não é o
// titular" — mesmo critério de `prescriptions`/`medications` `application/support.ts`) e a
// resolução da clínica selecionada (BR-APT-04/BR-CLN-02).
import type { AccessContext } from "../../access/index.js";
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
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

export interface SlotBookingSnapshot {
  slotId: string;
  clinicId: string;
  clinicName: string;
  scheduledAt: Date;
  specialty: string;
  professionalName?: string;
}

/**
 * UC-APT-07 (D17/BR-APT-04/06): resolve o pedido de marcação num horário de clínica parceira —
 * `clinicId` é obrigatório junto de `slotId` (endpoints.md `createAppointment`: o cliente já o
 * conhece, por ter chamado antes `GET /families/{familyId}/clinics/{clinicId}/slots`); a
 * especialidade/profissional/data e hora ficam **congelados** a partir do horário (mesmo critério
 * do nome da clínica em `resolveClinicSnapshot`), nunca do que o cliente enviar nesses campos.
 * `findActiveBySlot` é o pré-cheque de BR-APT-06 (a UNIQUE parcial do schema é a rede de segurança
 * final contra corrida, `db/migrations/0016_appointment_slot_booking.sql`).
 */
export async function resolveSlotBooking<Trx>(deps: AppointmentsDeps<Trx>, trx: Trx, familyId: string, clinicId: string, slotId: string): Promise<SlotBookingSnapshot> {
  const slot = await deps.clinics.findSlot(clinicId, slotId);
  if (!slot) {
    throw new ValidationError([{ field: "slotId", message: "horário inválido ou de outra clínica" }], { detail: "Horário inválido." });
  }
  const clinic = await deps.clinics.getBookableClinic(trx, familyId, clinicId);
  if (!clinic) {
    throw new ValidationError([{ field: "clinicId", message: "clínica inválida ou arquivada" }], { detail: "Clínica inválida." });
  }
  const active = await deps.appointmentsRepo.findActiveBySlot(trx, slotId);
  if (active) {
    throw new DomainError("CONFLICT", { detail: "Esse horário já tem uma marcação ativa." });
  }
  return {
    slotId: slot.id,
    clinicId: clinic.id,
    clinicName: clinic.name,
    scheduledAt: slot.startsAt,
    specialty: slot.specialty,
    ...(slot.professionalName ? { professionalName: slot.professionalName } : {}),
  };
}
