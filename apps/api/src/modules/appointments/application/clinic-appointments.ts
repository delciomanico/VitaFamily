// Casos de uso do portal da clínica parceira sobre `Appointment` (D17/D18, BR-CLN-03/06,
// endpoints.md `/clinic-portal/requests/*` e `/clinic-portal/agenda/*` — tag "Clinic Portal").
// Autenticados pelo ator de clínica (`ClinicActorInfo`, ADR-020) — nunca `AccessPolicy`/`User`
// (authorization.md §6.1: a verificação é a própria "clínica do caminho = clínica da sessão",
// feita aqui por `findByClinicId`/`listByClinicAndStatus`, nunca pela política de família).
// Devolve sempre `ClinicAppointmentView` (BR-CLN-03: nome do paciente, especialidade,
// profissional, data/hora, observações do pedido, motivo da clínica — nunca o `Appointment`
// completo nem qualquer outro dado de saúde/família).
import { ConflictError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidAppointmentTransition, type Appointment, type AppointmentStatus, type ConfirmationSource, type ConfirmationStatus } from "../domain/appointment.js";
import { deriveDayState, waitingMinutes, type DayState } from "../domain/day-flow.js";
import type { AppointmentsDeps, ClinicPortalActor, ClinicPrescriptionInput, RequestContext } from "./ports.js";

export interface ClinicAppointmentView {
  id: string;
  status: AppointmentStatus;
  scheduledAt: string;
  specialty?: string;
  professionalName?: string;
  patientName: string;
  notes?: string;
  responseNote?: string;
  /** M14 P (BR-CLN-18): `VITA` por omissão; `MANUAL` = visita presencial só da clínica. */
  source?: "VITA" | "MANUAL";
  clinicPatientId?: string;
  slotId?: string;
  /** M14 Q (BR-CLN-25/28/30). */
  confirmationStatus: ConfirmationStatus;
  confirmationSource?: ConfirmationSource;
  dayState: DayState;
  arrivedAt?: string;
  startedAt?: string;
  waitingMinutes?: number;
  followUpDueOn?: string;
}

/** `memberId -> clinicPatientId` em lote (M14 P): consultas Vita associam-se ao paciente da clínica pela ligação. */
export async function patientIdsOf<Trx>(deps: AppointmentsDeps<Trx>, trx: Trx, clinicId: string, appointments: Appointment[]): Promise<Map<string, string>> {
  return deps.clinicPatients.findPatientIdsByMembers(trx, clinicId, [...new Set(appointments.map((a) => a.memberId))]);
}

export async function toView<Trx>(deps: AppointmentsDeps<Trx>, trx: Trx, appointment: Appointment, patientIds?: Map<string, string>): Promise<ClinicAppointmentView> {
  const now = deps.clock.now();
  const waiting = waitingMinutes(appointment.arrivedAt, appointment.startedAt, now);
  const patientName = (await deps.memberNames.getMemberName(trx, appointment.familyId, appointment.memberId)) ?? "Membro da família";
  const ids = appointment.clinicId ? (patientIds ?? (await patientIdsOf(deps, trx, appointment.clinicId, [appointment]))) : new Map<string, string>();
  const clinicPatientId = ids.get(appointment.memberId);
  return {
    id: appointment.id,
    status: appointment.status,
    scheduledAt: appointment.scheduledAt.toISOString(),
    patientName,
    source: "VITA",
    confirmationStatus: appointment.confirmationStatus,
    dayState: deriveDayState(appointment.status, appointment.arrivedAt, appointment.startedAt),
    ...(appointment.confirmationSource ? { confirmationSource: appointment.confirmationSource } : {}),
    ...(appointment.arrivedAt ? { arrivedAt: appointment.arrivedAt.toISOString() } : {}),
    ...(appointment.startedAt ? { startedAt: appointment.startedAt.toISOString() } : {}),
    ...(waiting !== null ? { waitingMinutes: waiting } : {}),
    ...(appointment.followUpDueOn ? { followUpDueOn: appointment.followUpDueOn } : {}),
    ...(clinicPatientId ? { clinicPatientId } : {}),
    ...(appointment.slotId ? { slotId: appointment.slotId } : {}),
    ...(appointment.specialty ? { specialty: appointment.specialty } : {}),
    ...(appointment.professionalName ? { professionalName: appointment.professionalName } : {}),
    ...(appointment.notes ? { notes: appointment.notes } : {}),
    ...(appointment.responseNote ? { responseNote: appointment.responseNote } : {}),
  };
}

/** `GET /clinic-portal/requests` (UC-CLN-05): pedidos (`REQUESTED`) da própria clínica. */
export function createListClinicRequestsUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function listClinicRequests(actor: ClinicPortalActor): Promise<ClinicAppointmentView[]> {
    return deps.withTransaction(async (trx) => {
      const appointments = await deps.appointmentsRepo.listByClinicAndStatus(trx, actor.clinicId, ["REQUESTED"], {});
      const patientIds = await patientIdsOf(deps, trx, actor.clinicId, appointments);
      return Promise.all(appointments.map((appointment) => toView(deps, trx, appointment, patientIds)));
    });
  };
}

export interface ListClinicAgendaQuery {
  from?: Date;
  to?: Date;
}

const AGENDA_STATUSES: AppointmentStatus[] = ["SCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED"];

/** `GET /clinic-portal/agenda` (UC-CLN-06; M14 P: inclui as visitas manuais, BR-CLN-18): consultas confirmadas (e os seus desfechos) da própria clínica. */
export function createListClinicAgendaUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function listClinicAgenda(actor: ClinicPortalActor, query: ListClinicAgendaQuery): Promise<ClinicAppointmentView[]> {
    return deps.withTransaction(async (trx) => {
      const appointments = await deps.appointmentsRepo.listByClinicAndStatus(trx, actor.clinicId, AGENDA_STATUSES, query);
      const patientIds = await patientIdsOf(deps, trx, actor.clinicId, appointments);
      const views = await Promise.all(appointments.map((appointment) => toView(deps, trx, appointment, patientIds)));
      const visits = await deps.clinicPatients.listVisits(trx, actor.clinicId, query);
      return [...views, ...visits].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    });
  };
}

async function requireOwnRequest<Trx>(deps: AppointmentsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, appointmentId: string): Promise<Appointment> {
  const appointment = await deps.appointmentsRepo.findByClinicId(trx, actor.clinicId, appointmentId);
  if (!appointment) {
    throw new NotFoundError({ detail: "Pedido não encontrado." });
  }
  return appointment;
}

export type ClinicRequestDecision = "CONFIRM" | "REJECT";

export interface RespondClinicRequestInput {
  decision: ClinicRequestDecision;
  note?: string | null;
}

/** `PUT /clinic-portal/requests/{appointmentId}` (UC-CLN-05): confirmar (-> SCHEDULED) ou recusar
 * (-> REJECTED, horário volta a ficar livre, BR-APT-06) um pedido da própria clínica. */
export function createRespondClinicRequestUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function respondClinicRequest(actor: ClinicPortalActor, appointmentId: string, input: RespondClinicRequestInput, context: RequestContext): Promise<ClinicAppointmentView> {
    return deps.withTransaction(async (trx) => {
      const existing = await requireOwnRequest(deps, trx, actor, appointmentId);
      if (existing.status !== "REQUESTED") {
        throw new ConflictError({ detail: "Pedido já respondido." });
      }
      const nextStatus: AppointmentStatus = input.decision === "CONFIRM" ? "SCHEDULED" : "REJECTED";
      assertValidAppointmentTransition(existing.status, nextStatus);

      const now = deps.clock.now();
      const responseNote = input.note?.trim() ? input.note.trim() : null;
      const appointment = await deps.appointmentsRepo.updateStatusByClinic(trx, appointmentId, { status: nextStatus, responseNote });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "APPOINTMENT_STATUS",
        resourceType: "Appointment",
        resourceId: appointmentId,
        familyId: existing.familyId,
        subjectMemberId: existing.memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { from: existing.status, to: nextStatus },
      });

      return toView(deps, trx, appointment);
    });
  };
}

export interface CancelClinicAppointmentInput {
  note: string;
}

/** `PUT /clinic-portal/agenda/{appointmentId}/cancel` (UC-CLN-06): cancelar uma consulta
 * confirmada e futura da própria clínica, com motivo obrigatório. */
export function createCancelClinicAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function cancelClinicAppointment(actor: ClinicPortalActor, appointmentId: string, input: CancelClinicAppointmentInput, context: RequestContext): Promise<ClinicAppointmentView> {
    const note = input.note.trim();
    if (!note) {
      throw new ValidationError([{ field: "note", message: "obrigatório" }], { detail: "Motivo obrigatório para cancelar." });
    }

    return deps.withTransaction(async (trx) => {
      const found = await deps.appointmentsRepo.findByClinicId(trx, actor.clinicId, appointmentId);
      if (!found) {
        // M14 P (BR-CLN-18): o id pode ser o de uma visita manual da própria clínica.
        const visit = await deps.clinicPatients.cancelVisit(trx, actor, appointmentId, note, context);
        if (!visit) {
          throw new NotFoundError({ detail: "Pedido não encontrado." });
        }
        return visit;
      }
      const existing = found;
      const now = deps.clock.now();
      if (existing.status !== "SCHEDULED" || existing.scheduledAt.getTime() <= now.getTime()) {
        throw new ConflictError({ detail: "Só consultas confirmadas e futuras podem ser canceladas pela clínica." });
      }
      assertValidAppointmentTransition(existing.status, "CANCELLED");

      const appointment = await deps.appointmentsRepo.updateStatusByClinic(trx, appointmentId, { status: "CANCELLED", responseNote: note });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "APPOINTMENT_STATUS",
        resourceType: "Appointment",
        resourceId: appointmentId,
        familyId: existing.familyId,
        subjectMemberId: existing.memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { from: existing.status, to: "CANCELLED" },
      });

      return toView(deps, trx, appointment);
    });
  };
}

export interface CompleteConsultationInput {
  outcomeNote?: string | null;
  /** Opcional (BR-CLN-06/BR-RX-07): se presente, emite a receita associada (`issuedBy=CLINIC`). */
  prescription?: ClinicPrescriptionInput | null;
}

/** `PUT /clinic-portal/agenda/{appointmentId}/complete` (D18, BR-CLN-06/BR-RX-07): completa a
 * consulta `SCHEDULED` em curso da própria clínica — marca `COMPLETED`, regista o resultado e,
 * opcionalmente, emite a receita (via `PrescriptionsPort`, na MESMA transação: tudo ou nada, mesmo
 * critério de `prescriptions.createPrescription` com `medications`). */
export function createCompleteClinicAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function completeClinicAppointment(actor: ClinicPortalActor, appointmentId: string, input: CompleteConsultationInput, context: RequestContext): Promise<ClinicAppointmentView> {
    return deps.withTransaction(async (trx) => {
      const found = await deps.appointmentsRepo.findByClinicId(trx, actor.clinicId, appointmentId);
      if (!found) {
        // M14 P (BR-CLN-18): visita manual — só `outcomeNote`; com `prescription` => `VALIDATION_ERROR`.
        const visit = await deps.clinicPatients.completeVisit(trx, actor, appointmentId, { outcomeNote: input.outcomeNote ?? null, prescription: input.prescription }, context);
        if (!visit) {
          throw new NotFoundError({ detail: "Pedido não encontrado." });
        }
        return visit;
      }
      const existing = found;
      // endpoints.md (completeClinicAppointment): "CONFLICT (consulta não está SCHEDULED, ST4)" —
      // só a consulta em curso (nunca repete a mesma conclusão nem completa duas vezes).
      if (existing.status !== "SCHEDULED") {
        throw new ConflictError({ detail: "Só a consulta em curso (SCHEDULED) pode ser completada." });
      }
      assertValidAppointmentTransition(existing.status, "COMPLETED");

      const now = deps.clock.now();
      const outcomeNote = input.outcomeNote?.trim() ? input.outcomeNote.trim() : null;
      const appointment = await deps.appointmentsRepo.completeByClinic(trx, appointmentId, {
        outcomeNote,
        clinicAccountId: actor.clinicAccountId,
        recordedAt: now,
      });

      if (input.prescription) {
        await deps.prescriptions.issueForClinic(
          trx,
          existing.familyId,
          existing.memberId,
          input.prescription,
          { clinicAccountId: actor.clinicAccountId, appointmentId },
          context,
        );
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "APPOINTMENT_STATUS",
        resourceType: "Appointment",
        resourceId: appointmentId,
        familyId: existing.familyId,
        subjectMemberId: existing.memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { from: existing.status, to: "COMPLETED", hasPrescription: Boolean(input.prescription) },
      });

      return toView(deps, trx, appointment);
    });
  };
}
