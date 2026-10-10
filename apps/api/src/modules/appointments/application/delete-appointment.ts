// openapi.yaml `deleteAppointment`: "Autorização: WRITE(APPOINTMENTS)." UC-APT-06: sem documentos
// associados no MVP; lembretes associados ficam a cargo de `alerts` (M8) quando a fonte deixar de existir.
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, AppointmentsDeps, RequestContext } from "./ports.js";

export function createDeleteAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function deleteAppointment(actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, context: RequestContext): Promise<void> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "DELETE",
        subjectMemberId: memberId,
        category: "APPOINTMENTS",
      });

      const existing = await deps.appointmentsRepo.findById(trx, familyId, memberId, appointmentId);
      if (!existing) {
        throw new NotFoundError({ detail: "Consulta não encontrada." });
      }

      await deps.appointmentsRepo.delete(trx, familyId, memberId, appointmentId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "APPOINTMENT_DELETE",
        resourceType: "Appointment",
        resourceId: appointmentId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
