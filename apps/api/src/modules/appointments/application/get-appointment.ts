// openapi.yaml `getAppointment`: "Autorização: READ(APPOINTMENTS)."
import { NotFoundError } from "../../../platform/errors/index.js";
import type { ActorIdentity, Appointment, AppointmentsDeps, RequestContext } from "./ports.js";
import { auditViewIfNotSelf } from "./support.js";

export function createGetAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function getAppointment(actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, context: RequestContext): Promise<Appointment> {
    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "APPOINTMENTS",
      });

      const appointment = await deps.appointmentsRepo.findById(trx, familyId, memberId, appointmentId);
      if (!appointment) {
        throw new NotFoundError({ detail: "Consulta não encontrada." });
      }
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, context });
      return appointment;
    });
  };
}
