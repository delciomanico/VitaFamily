// openapi.yaml `setAppointmentStatus`: "Autorização: WRITE(APPOINTMENTS). ST4."
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidAppointmentTransition, type Appointment, type AppointmentStatus } from "../domain/appointment.js";
import type { ActorIdentity, AppointmentsDeps, RequestContext } from "./ports.js";

export interface SetAppointmentStatusInput {
  status: AppointmentStatus;
}

export function createSetAppointmentStatusUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function setAppointmentStatus(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    appointmentId: string,
    input: SetAppointmentStatusInput,
    context: RequestContext,
  ): Promise<Appointment> {
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
      assertValidAppointmentTransition(existing.status, input.status);

      const appointment = await deps.appointmentsRepo.updateStatus(trx, familyId, memberId, appointmentId, input.status);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "APPOINTMENT_STATUS",
        resourceType: "Appointment",
        resourceId: appointmentId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { from: existing.status, to: input.status },
      });

      return appointment;
    });
  };
}
