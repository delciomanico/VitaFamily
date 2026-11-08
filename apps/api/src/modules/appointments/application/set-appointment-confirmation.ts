// openapi.yaml `setAppointmentConfirmation` (M14 Q, BR-CLN-25/26, UC-CLN-20): "Vou" / "Não posso" do paciente a uma consulta
// `SCHEDULED`, futura e de clínica parceira. "Não posso" cancela a consulta na MESMA transação (liberta o horário, BR-APT-06) e
// marca `DECLINED`; sem motivo e sem alerta à clínica (não há alertas de clínica, OP-36). Autorização: a mesma de
// `setAppointmentStatus` (WRITE(APPOINTMENTS)); auditoria sem dados pessoais.
import { DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidAppointmentTransition, type Appointment } from "../domain/appointment.js";
import type { ActorIdentity, AppointmentsDeps, RequestContext } from "./ports.js";

export type ConfirmationResponse = "GOING" | "CANNOT";

export interface SetAppointmentConfirmationInput {
  response: string;
}

function invalid(detail: string): DomainError {
  return new DomainError("INVALID_STATE_TRANSITION", { detail });
}

export function createSetAppointmentConfirmationUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function setAppointmentConfirmation(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    appointmentId: string,
    input: SetAppointmentConfirmationInput,
    context: RequestContext,
  ): Promise<Appointment> {
    if (input.response !== "GOING" && input.response !== "CANNOT") {
      throw new ValidationError([{ field: "response", message: "GOING ou CANNOT" }], { detail: "Resposta inválida." });
    }
    const response: ConfirmationResponse = input.response;

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
      // BR-CLN-26: a confirmação ativa só existe em clínica parceira (consulta com horário).
      if (!existing.slotId) {
        throw new ValidationError([{ field: "appointmentId", message: "só consultas de clínica parceira" }], { detail: "A confirmação ativa só existe em clínicas parceiras." });
      }
      // Repetir a mesma resposta é idempotente (200); "Vou" depois de "Não posso" pede novo horário.
      if (existing.confirmationStatus === "DECLINED") {
        if (response === "CANNOT") return existing;
        throw invalid("A consulta foi cancelada; peça um novo horário.");
      }
      const now = deps.clock.now();
      if (existing.status !== "SCHEDULED" || existing.scheduledAt.getTime() <= now.getTime()) {
        throw invalid("Só consultas agendadas e futuras podem ser confirmadas.");
      }
      if (response === "GOING" && existing.confirmationStatus === "CONFIRMED" && existing.confirmationSource === "PATIENT") {
        return existing;
      }

      let appointment: Appointment;
      if (response === "GOING") {
        // A última resposta prevalece: "Vou" depois de "confirmado por telefone" passa a `PATIENT`.
        appointment = await deps.appointmentsRepo.applyConfirmation(trx, familyId, memberId, appointmentId, { confirmationStatus: "CONFIRMED", confirmationSource: "PATIENT", confirmedAt: now });
      } else {
        assertValidAppointmentTransition(existing.status, "CANCELLED");
        appointment = await deps.appointmentsRepo.applyConfirmation(trx, familyId, memberId, appointmentId, { confirmationStatus: "DECLINED", confirmationSource: null, confirmedAt: null, cancel: true });
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "APPOINTMENT_CONFIRMATION_SET",
        resourceType: "Appointment",
        resourceId: appointmentId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { response },
      });

      return appointment;
    });
  };
}
