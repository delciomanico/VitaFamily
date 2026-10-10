// openapi.yaml `updateAppointment`: "Autorização: WRITE(APPOINTMENTS). Recalcula lembretes
// futuros." (o recálculo é da responsabilidade de `alerts`, M8 — ver create-appointment.ts).
import { ValidationError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { Appointment } from "../domain/appointment.js";
import type { ActorIdentity, AppointmentChanges, AppointmentsDeps, RequestContext } from "./ports.js";
import { resolveClinicSnapshot } from "./support.js";

export interface UpdateAppointmentInput {
  scheduledAt?: string | null;
  professionalName?: string | null;
  clinicId?: string | null;
  clinicName?: string | null;
  reason?: string | null;
  notes?: string | null;
}

function parseScheduledAt(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field: "scheduledAt", message: "data/hora inválida" }], { detail: "Data/hora da consulta inválida." });
  }
  return date;
}

export function createUpdateAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function updateAppointment(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    appointmentId: string,
    input: UpdateAppointmentInput,
    context: RequestContext,
  ): Promise<Appointment> {
    if (input.scheduledAt === null) {
      throw new ValidationError([{ field: "scheduledAt", message: "obrigatório" }], { detail: "Data/hora não pode ser removida." });
    }

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "UPDATE",
        subjectMemberId: memberId,
        category: "APPOINTMENTS",
      });

      const existing = await deps.appointmentsRepo.findById(trx, familyId, memberId, appointmentId);
      if (!existing) {
        throw new NotFoundError({ detail: "Consulta não encontrada." });
      }

      const changes: AppointmentChanges = {
        ...(input.scheduledAt ? { scheduledAt: parseScheduledAt(input.scheduledAt) } : {}),
        ...(input.professionalName !== undefined ? { professionalName: input.professionalName } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      if (input.clinicId !== undefined || input.clinicName !== undefined) {
        const clinicSnapshot = await resolveClinicSnapshot(deps, trx, familyId, input.clinicId, input.clinicName);
        changes.clinicId = clinicSnapshot.clinicId ?? null;
        changes.clinicName = clinicSnapshot.clinicName ?? null;
      }

      const appointment = await deps.appointmentsRepo.update(trx, familyId, memberId, appointmentId, changes);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "APPOINTMENT_UPDATE",
        resourceType: "Appointment",
        resourceId: appointmentId,
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
