// openapi.yaml `deleteAppointment`: "Autorização: WRITE(APPOINTMENTS)." UC-APT-06: sem documentos
// associados no MVP; lembretes associados ficam a cargo de `alerts` (M8) quando a fonte deixar de existir.
import { ConflictError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, AppointmentsDeps, RequestContext } from "./ports.js";
import { userProcessActor } from "./support.js";

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

      // BR-MKT-55: a consulta gerada por uma marcação só se apaga com a marcação terminal (o estado da consulta segue o da
      // marcação: COMPLETED/NO_SHOW/CANCELLED); apagá-la NÃO apaga o `Process` (é o da marcação) nem a marcação.
      const managed = existing.bookingId !== undefined;
      if (managed && !["COMPLETED", "NO_SHOW", "CANCELLED"].includes(existing.status)) {
        throw new ConflictError({ detail: "Esta consulta é gerida pela marcação com o profissional; só pode apagá-la depois de terminada." });
      }
      await deps.appointmentsRepo.delete(trx, familyId, memberId, appointmentId);
      // BR-PRC-07: apagar o ato apaga o seu Process na mesma transação.
      if (!managed) await deps.processes.discard(trx, { originType: "APPOINTMENT", originId: appointmentId, by: userProcessActor(actor, context) });

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
