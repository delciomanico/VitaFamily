// openapi.yaml `createAppointment`: "Autorização: WRITE(APPOINTMENTS). FR-APT-01; gera lembretes
// 24 h e 2 h se futura." A geração de lembretes é responsabilidade de `alerts` (M8, modules.md §2:
// `alerts` depende de `appointments`, nunca o inverso) — este módulo só garante que os dados
// (`scheduledAt`, `status`) ficam corretos para esse scanner ler mais tarde.
import { ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidCreationStatus, type Appointment, type AppointmentStatus } from "../domain/appointment.js";
import type { ActorIdentity, AppointmentsDeps, NewAppointmentRecord, RequestContext } from "./ports.js";
import { resolveClinicSnapshot, resolveSlotBooking } from "./support.js";

export interface CreateAppointmentInput {
  scheduledAt: string;
  professionalName?: string | null;
  clinicId?: string | null;
  clinicName?: string | null;
  specialty?: string | null;
  reason?: string | null;
  notes?: string | null;
  status?: AppointmentStatus | null;
  /** Marcação num horário de clínica parceira (D17/UC-APT-07) — "em vez de" `clinicName`
   * (endpoints.md `createAppointment`); `clinicId` continua obrigatório para identificar o
   * horário (ver `support.ts#resolveSlotBooking`). Ignora `status`/`scheduledAt`/`specialty`/
   * `professionalName`/`clinicName` quando presente (congelados a partir do horário). */
  slotId?: string | null;
}

function parseScheduledAt(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field: "scheduledAt", message: "data/hora inválida" }], { detail: "Data/hora da consulta inválida." });
  }
  return date;
}

export function createCreateAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function createAppointment(actor: ActorIdentity, familyId: string, memberId: string, input: CreateAppointmentInput, context: RequestContext): Promise<Appointment> {
    const hasSlotId = Boolean(input.slotId);
    if (hasSlotId && !input.clinicId) {
      throw new ValidationError([{ field: "clinicId", message: "obrigatório com slotId" }], { detail: "Clínica obrigatória para marcar num horário." });
    }

    // UC-APT-01 alternativo: registo retroativo pode nascer já REALIZADA; por omissão, AGENDADA
    // mesmo se `scheduledAt` for passado (BR-APT-02: o sistema nunca assume o desfecho).
    const status = hasSlotId ? "REQUESTED" : input.status ?? "SCHEDULED";
    assertValidCreationStatus(status, hasSlotId);

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "CREATE",
        subjectMemberId: memberId,
        category: "APPOINTMENTS",
      });

      const now = deps.clock.now();
      let record: NewAppointmentRecord;
      if (hasSlotId && input.slotId && input.clinicId) {
        const booking = await resolveSlotBooking(deps, trx, familyId, input.clinicId, input.slotId);
        record = {
          id: newId(),
          familyId,
          memberId,
          scheduledAt: booking.scheduledAt,
          status,
          createdAt: now,
          clinicId: booking.clinicId,
          clinicName: booking.clinicName,
          specialty: booking.specialty,
          slotId: booking.slotId,
          ...(booking.professionalName ? { professionalName: booking.professionalName } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
        };
      } else {
        // UC-APT-07 (D17): `scheduledAt` só se valida aqui (sem `slotId`) — com horário, o valor
        // vem sempre do próprio horário (acima), nunca do que o cliente enviar (BR-APT-04/06).
        const clinicSnapshot = await resolveClinicSnapshot(deps, trx, familyId, input.clinicId, input.clinicName);
        record = {
          id: newId(),
          familyId,
          memberId,
          scheduledAt: parseScheduledAt(input.scheduledAt),
          status,
          createdAt: now,
          ...(input.professionalName ? { professionalName: input.professionalName } : {}),
          ...(input.specialty ? { specialty: input.specialty } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          ...clinicSnapshot,
        };
      }
      const appointment = await deps.appointmentsRepo.insert(trx, record);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "APPOINTMENT_CREATE",
        resourceType: "Appointment",
        resourceId: appointment.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return appointment;
    });
  };
}
