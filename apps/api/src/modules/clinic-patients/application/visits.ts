// Visitas presenciais manuais (BR-CLN-18, UC-CLN-14/08): marcar, listar, cancelar e completar — só da clínica,
// sem receita, sem lembretes Vita. A marcação serializa-se pelo mesmo bloqueio do horário (`FOR UPDATE`) que a
// consulta Vita e o exame (BR-APT-06/11): visita×consulta no mesmo horário => só uma vence. Auditoria
// `CLINIC_VISIT_BOOK/CANCEL/COMPLETE` sem notas nem motivo.
import { ConflictError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { deriveVisitDayState, visitWaitingMinutes, type VisitDayState } from "../domain/day-flow.js";
import {
  assertCanCancelVisit,
  assertCanCompleteVisit,
  assertNoPrescription,
  normalizeVisitNote,
  type ClinicVisit,
} from "../domain/clinic-visit.js";
import { isDoctor, slotsOfDoctor, visitIsDoctors } from "./doctor-scope.js";
import type { ClinicPatientsDeps, ClinicPortalActor, RequestContext, SlotFacts } from "./ports.js";

/** `ClinicBooking` (openapi) de uma visita manual: mínimo necessário (BR-CLN-03). */
export interface ClinicVisitBookingView {
  id: string;
  status: ClinicVisit["status"];
  scheduledAt: string;
  specialty?: string;
  professionalName?: string;
  patientName: string;
  notes?: string;
  responseNote?: string;
  source: "MANUAL";
  clinicPatientId: string;
  slotId?: string;
  /** M14 Q (BR-CLN-25/28/30): visitas só `PENDING|CONFIRMED`, origem sempre `CLINIC`. */
  confirmationStatus: "PENDING" | "CONFIRMED";
  confirmationSource?: "CLINIC";
  dayState: VisitDayState;
  arrivedAt?: string;
  startedAt?: string;
  waitingMinutes?: number;
  followUpDueOn?: string;
  /** M14 R (BR-CLN-31): recibo `ISSUED` da visita; nunca para o Médico. */
  receiptId?: string;
}

/** BR-CLN-31/39: acrescenta `receiptId` às visitas concluídas (Admin/Gestor apenas). */
export async function attachVisitReceiptIds<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, views: ClinicVisitBookingView[]): Promise<ClinicVisitBookingView[]> {
  const completed = views.filter((v) => v.status === "COMPLETED");
  if (isDoctor(actor) || completed.length === 0) return views;
  const ids = await deps.receipts.findIssuedReceiptIds(trx, actor.clinicId, "VISIT", completed.map((v) => v.id));
  return views.map((v) => {
    const receiptId = ids.get(v.id);
    return receiptId ? { ...v, receiptId } : v;
  });
}

export async function toVisitViews<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, clinicId: string, visits: ClinicVisit[]): Promise<ClinicVisitBookingView[]> {
  if (visits.length === 0) return [];
  const patients = await deps.patientsRepo.findManyByIds(trx, clinicId, [...new Set(visits.map((v) => v.clinicPatientId))]);
  const names = new Map(patients.map((p) => [p.id, p.name]));
  const slotIds = [...new Set(visits.flatMap((v) => (v.slotId ? [v.slotId] : [])))];
  const slots = new Map((slotIds.length === 0 ? [] : await deps.slots.findSlotsByIds(trx, clinicId, slotIds)).map((s) => [s.id, s]));
  const now = deps.clock.now();
  return visits.map((visit) => {
    const slot = visit.slotId ? slots.get(visit.slotId) : undefined;
    const waiting = visitWaitingMinutes(visit.arrivedAt, visit.startedAt, now);
    return {
      confirmationStatus: visit.confirmationStatus,
      dayState: deriveVisitDayState(visit.status, visit.arrivedAt, visit.startedAt),
      ...(visit.confirmationStatus === "CONFIRMED" ? { confirmationSource: "CLINIC" as const } : {}),
      ...(visit.arrivedAt ? { arrivedAt: visit.arrivedAt.toISOString() } : {}),
      ...(visit.startedAt ? { startedAt: visit.startedAt.toISOString() } : {}),
      ...(waiting !== null ? { waitingMinutes: waiting } : {}),
      ...(visit.followUpDueOn ? { followUpDueOn: visit.followUpDueOn } : {}),
      id: visit.id,
      status: visit.status,
      scheduledAt: visit.scheduledAt.toISOString(),
      patientName: names.get(visit.clinicPatientId) ?? "Paciente",
      source: "MANUAL" as const,
      clinicPatientId: visit.clinicPatientId,
      ...(slot ? { specialty: slot.specialty } : {}),
      ...(slot?.professionalName ? { professionalName: slot.professionalName } : {}),
      ...(visit.notes ? { notes: visit.notes } : {}),
      ...(visit.cancelNote ? { responseNote: visit.cancelNote } : {}),
      ...(visit.slotId ? { slotId: visit.slotId } : {}),
    };
  });
}

async function viewOf<Trx>(deps: ClinicPatientsDeps<Trx>, trx: Trx, clinicId: string, visit: ClinicVisit): Promise<ClinicVisitBookingView> {
  const [view] = await toVisitViews(deps, trx, clinicId, [visit]);
  if (!view) throw new Error("vista da visita em falta");
  return view;
}

export interface BookVisitInput {
  clinicPatientId: string;
  slotId: string;
  notes?: string | null;
}

/** BR-CLN-18 (c): ordem horário → paciente → estado do horário → sobreposição (paciente e profissional). */
export function createBookVisitUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function bookVisit(trx: Trx, actor: ClinicPortalActor, input: BookVisitInput, context: RequestContext): Promise<ClinicVisitBookingView> {
    const notes = normalizeVisitNote(input.notes, "notes");
    const now = deps.clock.now();
    // 1. Horário da própria clínica (sob bloqueio da linha).
    const slot: SlotFacts | null = await deps.slots.lockSlot(trx, input.slotId);
    if (slot?.clinicId !== actor.clinicId) {
      throw new NotFoundError({ detail: "Horário não encontrado." });
    }
    // 2. Paciente da própria clínica.
    const patient = await deps.patientsRepo.findById(trx, actor.clinicId, input.clinicPatientId);
    if (!patient) {
      throw new NotFoundError({ detail: "Paciente não encontrado." });
    }
    // 3. Estado do horário (BR-APT-06: consulta ativa OU visita SCHEDULED ocupam-no).
    if (slot.kind !== "APPOINTMENT") {
      throw new ValidationError([{ field: "slotId", message: "horário de exame; só consultas" }], { detail: "Horário inválido para consulta." });
    }
    if (slot.startsAt.getTime() <= now.getTime()) {
      throw new ConflictError({ detail: "O horário já passou." });
    }
    const [appointmentCounts, visitCounts] = await Promise.all([deps.slots.countActiveBySlot(trx, [slot.id]), deps.visitsRepo.countScheduledBySlot(trx, [slot.id])]);
    if (appointmentCounts.some((row) => row.requested + row.scheduled > 0) || visitCounts.some((row) => row.count > 0)) {
      throw new ConflictError({ detail: "Esse horário já tem uma marcação ativa." });
    }
    // 4. Sobreposição por duração do paciente (entre visitas SCHEDULED, BR-CLN-16) e do profissional (BR-CLN-13).
    const endsAt = new Date(slot.startsAt.getTime() + slot.durationMinutes * 60_000);
    if ((await deps.visitsRepo.findScheduledOverlapping(trx, patient.id, slot.startsAt, endsAt)).length > 0) {
      throw new ConflictError({ detail: "O paciente já tem uma visita nesse período." });
    }
    if (slot.professionalId) {
      const others = await deps.slots.listProfessionalSlotsOverlapping(trx, slot.professionalId, slot.startsAt, endsAt, slot.id);
      if (others.length > 0) {
        // `countActiveBySlot` cobre consultas e exames (`appointments`+`examinations`); as visitas vêm do repositório próprio.
        const [booked, visits] = await Promise.all([deps.slots.countActiveBySlot(trx, others), deps.visitsRepo.countScheduledBySlot(trx, others)]);
        if (booked.some((row) => row.requested + row.scheduled > 0) || visits.some((row) => row.count > 0)) {
          throw new ConflictError({ detail: "O profissional já tem uma marcação nesse período." });
        }
      }
    }

    const visit = await deps.visitsRepo.insert(trx, {
      id: newId(),
      clinicId: actor.clinicId,
      clinicPatientId: patient.id,
      slotId: slot.id,
      scheduledAt: slot.startsAt,
      durationMinutes: slot.durationMinutes,
      notes,
      bookedByClinicAccountId: actor.clinicAccountId,
      createdAt: now,
    });
    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "CLINIC_ACCOUNT",
      actorClinicAccountId: actor.clinicAccountId,
      action: "CLINIC_VISIT_BOOK",
      resourceType: "ClinicVisit",
      resourceId: visit.id,
      result: "SUCCESS",
      requestId: context.requestId,
      ...auditContextFields(context),
      metadata: { slotId: slot.id },
    });
    return viewOf(deps, trx, actor.clinicId, visit);
  };
}

export function createListVisitsUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function listVisits(trx: Trx, clinicId: string, filter: { from?: Date; to?: Date; professionalId?: string }): Promise<ClinicVisitBookingView[]> {
    let visits = await deps.visitsRepo.list(trx, clinicId, { ...(filter.from ? { from: filter.from } : {}), ...(filter.to ? { to: filter.to } : {}) });
    if (filter.professionalId) {
      // BR-CLN-39: o Médico só vê as visitas do seu profissional.
      const own = await slotsOfDoctor(deps, trx, { clinicAccountId: "", clinicId, professionalId: filter.professionalId }, visits.map((v) => v.slotId ?? undefined));
      visits = visits.filter((v) => v.slotId && own.has(v.slotId));
    }
    return toVisitViews(deps, trx, clinicId, visits);
  };
}

/** `PUT …/agenda/{id}/cancel` sobre uma visita: `null` se o id não é uma visita da clínica (o chamador decide o 404). */
export function createCancelVisitUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function cancelVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, note: string, context: RequestContext): Promise<ClinicVisitBookingView | null> {
    const existing = await deps.visitsRepo.findById(trx, actor.clinicId, visitId);
    if (!existing) return null;
    const now = deps.clock.now();
    assertCanCancelVisit(existing, now);
    const visit = await deps.visitsRepo.setStatus(trx, actor.clinicId, visitId, { status: "CANCELLED", cancelNote: normalizeVisitNote(note, "note") }, now);
    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "CLINIC_ACCOUNT",
      actorClinicAccountId: actor.clinicAccountId,
      action: "CLINIC_VISIT_CANCEL",
      resourceType: "ClinicVisit",
      resourceId: visit.id,
      result: "SUCCESS",
      requestId: context.requestId,
      ...auditContextFields(context),
      metadata: { ...(existing.slotId ? { slotId: existing.slotId } : {}) },
    });
    return viewOf(deps, trx, actor.clinicId, visit);
  };
}

/** `PUT …/agenda/{id}/complete` sobre uma visita: só `outcomeNote`; com `prescription` => `VALIDATION_ERROR`. */
export function createCompleteVisitUseCase<Trx>(deps: ClinicPatientsDeps<Trx>) {
  return async function completeVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, input: { outcomeNote?: string | null; prescription?: unknown }, context: RequestContext): Promise<ClinicVisitBookingView | null> {
    const existing = await deps.visitsRepo.findById(trx, actor.clinicId, visitId);
    if (!existing || !(await visitIsDoctors(deps, trx, actor, existing))) return null;
    assertNoPrescription(input.prescription);
    assertCanCompleteVisit(existing);
    const now = deps.clock.now();
    const visit = await deps.visitsRepo.setStatus(trx, actor.clinicId, visitId, { status: "COMPLETED", outcomeNote: normalizeVisitNote(input.outcomeNote, "outcomeNote") }, now);
    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "CLINIC_ACCOUNT",
      actorClinicAccountId: actor.clinicAccountId,
      action: "CLINIC_VISIT_COMPLETE",
      resourceType: "ClinicVisit",
      resourceId: visit.id,
      result: "SUCCESS",
      requestId: context.requestId,
      ...auditContextFields(context),
      metadata: { ...(existing.slotId ? { slotId: existing.slotId } : {}) },
    });
    return viewOf(deps, trx, actor.clinicId, visit);
  };
}
