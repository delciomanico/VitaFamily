// Portal da clínica (M14 Q, BR-CLN-27/28/30, UC-CLN-20/21/23): "confirmado por telefone", Chegou, Iniciar, Faltou e retorno.
// `{appointmentId}` é o id de uma consulta Vita OU de uma visita manual (mesmo despacho de cancelar/concluir, BR-CLN-18): tenta
// a consulta da própria clínica e, se não existir, delega na porta `ClinicPatientDirectory` (visitas). Outra clínica => 404.
// Admin e Gestor iguais (authorization.md §6.2). Auditoria da clínica sem dados pessoais nem família/membro; só se algo mudou.
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import { assertValidAppointmentTransition, type Appointment } from "../domain/appointment.js";
import { computeFollowUpDueOn, planArrive, planNoShow, planPhoneConfirmation, planStart } from "../domain/day-flow.js";
import { toView, type ClinicAppointmentView } from "./clinic-appointments.js";
import type { AppointmentsDeps, ClinicPortalActor, RequestContext } from "./ports.js";

async function auditClinic<Trx>(deps: AppointmentsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, action: AuditAction, appointmentId: string, now: Date, context: RequestContext, metadata?: Record<string, string | number>): Promise<void> {
  await deps.audit.record(trx, {
    occurredAt: now,
    actorType: "CLINIC_ACCOUNT",
    actorClinicAccountId: actor.clinicAccountId,
    action,
    resourceType: "Appointment",
    resourceId: appointmentId,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
    ...(metadata ? { metadata } : {}),
  });
}

export function createConfirmClinicAppointmentByPhoneUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function confirmClinicAppointmentByPhone(actor: ClinicPortalActor, appointmentId: string, context: RequestContext): Promise<ClinicAppointmentView> {
    return deps.withTransaction(async (trx) => {
      const existing = await deps.appointmentsRepo.findByClinicId(trx, actor.clinicId, appointmentId);
      if (!existing) {
        const visit = await deps.clinicPatients.confirmVisit(trx, actor, appointmentId, context);
        if (!visit) throw new NotFoundError({ detail: "Marcação não encontrada." });
        return visit;
      }
      const now = deps.clock.now();
      if (!planPhoneConfirmation(existing, now)) return toView(deps, trx, existing);
      const updated = await deps.appointmentsRepo.applyConfirmationByClinic(trx, actor.clinicId, appointmentId, now);
      await auditClinic(deps, trx, actor, "CLINIC_APPOINTMENT_CONFIRM", appointmentId, now, context);
      return toView(deps, trx, updated);
    });
  };
}

export function createArriveClinicAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function arriveClinicAppointment(actor: ClinicPortalActor, appointmentId: string, context: RequestContext): Promise<ClinicAppointmentView> {
    return deps.withTransaction(async (trx) => {
      const existing = await deps.appointmentsRepo.findByClinicId(trx, actor.clinicId, appointmentId);
      if (!existing) {
        const visit = await deps.clinicPatients.arriveVisit(trx, actor, appointmentId, context);
        if (!visit) throw new NotFoundError({ detail: "Marcação não encontrada." });
        return visit;
      }
      const now = deps.clock.now();
      const plan = planArrive(existing, now);
      if (!plan.changed) return toView(deps, trx, existing);
      // NO_SHOW -> SCHEDULED é uma correção já prevista pela chegada tardia (BR-CLN-28, state-machines.md).
      const updated = await deps.appointmentsRepo.applyDayFlow(trx, actor.clinicId, appointmentId, { ...(plan.status !== existing.status ? { status: plan.status } : {}), arrivedAt: plan.arrivedAt });
      await auditClinic(deps, trx, actor, "CLINIC_APPOINTMENT_ARRIVE", appointmentId, now, context);
      return toView(deps, trx, updated);
    });
  };
}

export function createStartClinicAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function startClinicAppointment(actor: ClinicPortalActor, appointmentId: string, context: RequestContext): Promise<ClinicAppointmentView> {
    return deps.withTransaction(async (trx) => {
      const existing = await deps.appointmentsRepo.findByClinicId(trx, actor.clinicId, appointmentId);
      if (!existing) {
        const visit = await deps.clinicPatients.startVisit(trx, actor, appointmentId, context);
        if (!visit) throw new NotFoundError({ detail: "Marcação não encontrada." });
        return visit;
      }
      const now = deps.clock.now();
      const plan = planStart(existing, now);
      if (!plan.changed) return toView(deps, trx, existing);
      const updated = await deps.appointmentsRepo.applyDayFlow(trx, actor.clinicId, appointmentId, { arrivedAt: plan.arrivedAt, startedAt: plan.startedAt });
      await auditClinic(deps, trx, actor, "CLINIC_APPOINTMENT_START", appointmentId, now, context);
      return toView(deps, trx, updated);
    });
  };
}

export function createNoShowClinicAppointmentUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function noShowClinicAppointment(actor: ClinicPortalActor, appointmentId: string, context: RequestContext): Promise<ClinicAppointmentView> {
    return deps.withTransaction(async (trx) => {
      const existing = await deps.appointmentsRepo.findByClinicId(trx, actor.clinicId, appointmentId);
      if (!existing) {
        const visit = await deps.clinicPatients.noShowVisit(trx, actor, appointmentId, context);
        if (!visit) throw new NotFoundError({ detail: "Marcação não encontrada." });
        return visit;
      }
      const now = deps.clock.now();
      if (!planNoShow(existing, now)) return toView(deps, trx, existing);
      assertValidAppointmentTransition(existing.status, "NO_SHOW");
      // BR-CLN-28: a falta da clínica não reabre nem liberta o horário (NO_SHOW já não ocupa, mas o horário é passado).
      const updated = await deps.appointmentsRepo.applyDayFlow(trx, actor.clinicId, appointmentId, { status: "NO_SHOW" });
      await auditClinic(deps, trx, actor, "CLINIC_APPOINTMENT_NO_SHOW", appointmentId, now, context);
      return toView(deps, trx, updated);
    });
  };
}

export interface SetClinicFollowUpInput {
  amount: unknown;
  unit: unknown;
}

export function createSetClinicFollowUpUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function setClinicFollowUp(actor: ClinicPortalActor, appointmentId: string, input: SetClinicFollowUpInput, context: RequestContext): Promise<ClinicAppointmentView> {
    return deps.withTransaction(async (trx) => {
      const existing = await deps.appointmentsRepo.findByClinicId(trx, actor.clinicId, appointmentId);
      if (!existing) {
        const visit = await deps.clinicPatients.setVisitFollowUp(trx, actor, appointmentId, input, context);
        if (!visit) throw new NotFoundError({ detail: "Marcação não encontrada." });
        return visit;
      }
      const dueOn = computeFollowUpDueOn(existing, input.amount, input.unit);
      const now = deps.clock.now();
      const updated = await deps.appointmentsRepo.setFollowUp(trx, actor.clinicId, appointmentId, dueOn);
      await auditClinic(deps, trx, actor, "CLINIC_FOLLOWUP_SET", appointmentId, now, context, { amount: input.amount as number, unit: input.unit as string });
      return toView(deps, trx, updated);
    });
  };
}

export function createClearClinicFollowUpUseCase<Trx>(deps: AppointmentsDeps<Trx>) {
  return async function clearClinicFollowUp(actor: ClinicPortalActor, appointmentId: string, context: RequestContext): Promise<ClinicAppointmentView> {
    return deps.withTransaction(async (trx) => {
      const existing = await deps.appointmentsRepo.findByClinicId(trx, actor.clinicId, appointmentId);
      if (!existing) {
        const visit = await deps.clinicPatients.clearVisitFollowUp(trx, actor, appointmentId, context);
        if (!visit) throw new NotFoundError({ detail: "Marcação não encontrada." });
        return visit;
      }
      if (!existing.followUpDueOn) return toView(deps, trx, existing);
      const now = deps.clock.now();
      const updated: Appointment = await deps.appointmentsRepo.setFollowUp(trx, actor.clinicId, appointmentId, null);
      await auditClinic(deps, trx, actor, "CLINIC_FOLLOWUP_CLEAR", appointmentId, now, context);
      return toView(deps, trx, updated);
    });
  };
}
