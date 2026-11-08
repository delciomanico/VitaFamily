// Visitas manuais — confirmação por telefone, fluxo do dia e retorno (M14 Q, BR-CLN-27/28/30, UC-CLN-20/21/23). Chamadas pelo
// despacho de `/clinic-portal/agenda/{id}/…` (porta `ClinicPatientDirectory` de `appointments`): `null` se o id não é uma visita
// da clínica (o chamador decide o 404). Idempotentes; auditoria `CLINIC_VISIT_*`/`CLINIC_FOLLOWUP_*` só se algo mudou, sem
// dados pessoais.
import { auditContextFields, type AuditAction } from "../../audit/index.js";
import {
  computeVisitFollowUpDueOn,
  planVisitArrive,
  planVisitConfirmation,
  planVisitNoShow,
  planVisitStart,
} from "../domain/day-flow.js";
import type { ClinicVisit } from "../domain/clinic-visit.js";
import type { ClinicPatientsDeps, ClinicPortalActor, RequestContext } from "./ports.js";
import { toVisitViews, type ClinicVisitBookingView } from "./visits.js";

async function viewOf<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, clinicId: string, visit: ClinicVisit): Promise<ClinicVisitBookingView> {
  const [view] = await toVisitViews(deps, trx, clinicId, [visit]);
  if (!view) throw new Error("vista da visita em falta");
  return view;
}

async function audit<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, action: AuditAction, visitId: string, now: Date, context: RequestContext, metadata?: Record<string, string | number>): Promise<void> {
  await deps.audit.record(trx, {
    occurredAt: now,
    actorType: "CLINIC_ACCOUNT",
    actorClinicAccountId: actor.clinicAccountId,
    action,
    resourceType: "ClinicVisit",
    resourceId: visitId,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
    ...(metadata ? { metadata } : {}),
  });
}

export function createConfirmVisitUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function confirmVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null> {
    const existing = await deps.visitsRepo.findById(trx, actor.clinicId, visitId);
    if (!existing) return null;
    const now = deps.clock.now();
    if (!planVisitConfirmation(existing, now)) return viewOf(deps, trx, actor.clinicId, existing);
    const visit = await deps.visitsRepo.applyConfirmation(trx, actor.clinicId, visitId, now);
    await audit(deps, trx, actor, "CLINIC_VISIT_CONFIRM", visitId, now, context);
    return viewOf(deps, trx, actor.clinicId, visit);
  };
}

export function createArriveVisitUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function arriveVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null> {
    const existing = await deps.visitsRepo.findById(trx, actor.clinicId, visitId);
    if (!existing) return null;
    const now = deps.clock.now();
    const plan = planVisitArrive(existing, now);
    if (!plan.changed) return viewOf(deps, trx, actor.clinicId, existing);
    const visit = await deps.visitsRepo.applyDayFlow(trx, actor.clinicId, visitId, { ...(plan.status !== existing.status ? { status: plan.status } : {}), arrivedAt: plan.arrivedAt }, now);
    await audit(deps, trx, actor, "CLINIC_VISIT_ARRIVE", visitId, now, context);
    return viewOf(deps, trx, actor.clinicId, visit);
  };
}

export function createStartVisitUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function startVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null> {
    const existing = await deps.visitsRepo.findById(trx, actor.clinicId, visitId);
    if (!existing) return null;
    const now = deps.clock.now();
    const plan = planVisitStart(existing, now);
    if (!plan.changed) return viewOf(deps, trx, actor.clinicId, existing);
    const visit = await deps.visitsRepo.applyDayFlow(trx, actor.clinicId, visitId, { arrivedAt: plan.arrivedAt, startedAt: plan.startedAt }, now);
    await audit(deps, trx, actor, "CLINIC_VISIT_START", visitId, now, context);
    return viewOf(deps, trx, actor.clinicId, visit);
  };
}

export function createNoShowVisitUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function noShowVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null> {
    const existing = await deps.visitsRepo.findById(trx, actor.clinicId, visitId);
    if (!existing) return null;
    const now = deps.clock.now();
    if (!planVisitNoShow(existing, now)) return viewOf(deps, trx, actor.clinicId, existing);
    // BR-CLN-28: a falta não reabre o horário (passado); só deixa de ser `SCHEDULED`.
    const visit = await deps.visitsRepo.applyDayFlow(trx, actor.clinicId, visitId, { status: "NO_SHOW" }, now);
    await audit(deps, trx, actor, "CLINIC_VISIT_NO_SHOW", visitId, now, context);
    return viewOf(deps, trx, actor.clinicId, visit);
  };
}

export function createSetVisitFollowUpUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function setVisitFollowUp(trx: Trx, actor: ClinicPortalActor, visitId: string, input: { amount: unknown; unit: unknown }, context: RequestContext): Promise<ClinicVisitBookingView | null> {
    const existing = await deps.visitsRepo.findById(trx, actor.clinicId, visitId);
    if (!existing) return null;
    const dueOn = computeVisitFollowUpDueOn(existing, input.amount, input.unit);
    const now = deps.clock.now();
    const visit = await deps.visitsRepo.setFollowUp(trx, actor.clinicId, visitId, dueOn, now);
    await audit(deps, trx, actor, "CLINIC_FOLLOWUP_SET", visitId, now, context, { amount: input.amount as number, unit: input.unit as string });
    return viewOf(deps, trx, actor.clinicId, visit);
  };
}

export function createClearVisitFollowUpUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function clearVisitFollowUp(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null> {
    const existing = await deps.visitsRepo.findById(trx, actor.clinicId, visitId);
    if (!existing) return null;
    if (!existing.followUpDueOn) return viewOf(deps, trx, actor.clinicId, existing);
    const now = deps.clock.now();
    const visit = await deps.visitsRepo.setFollowUp(trx, actor.clinicId, visitId, null, now);
    await audit(deps, trx, actor, "CLINIC_FOLLOWUP_CLEAR", visitId, now, context);
    return viewOf(deps, trx, actor.clinicId, visit);
  };
}
