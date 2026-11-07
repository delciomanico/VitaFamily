// Bloqueios/férias de um profissional (M14 a2, UC-CLN-13, BR-CLN-14): criar remove só os horários
// futuros e LIVRES que intersectam o intervalo e lista os marcados (nunca os cancela nem cancela
// marcações); remover regenera o intervalo. Serializado por bloqueio da linha do profissional e depois
// dos horários (mesma ordem de BR-APT-11/schema.md §3a). Auditoria sem a nota (`reason`) nem pacientes.
import { newId } from "../../../platform/ids/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import { assertValidTimeOffRange, addGeneration, emptyGeneration, normalizeTimeOffReason, slotIntersectsTimeOff, type ClinicTimeOff, type ScheduleGeneration } from "../domain/clinic-schedule.js";
import type { ClinicSlotKind } from "../domain/clinic-slot.js";
import { auditClinicWrite } from "./clinic-catalog.js";
import type { ClinicPortalActor, ClinicsDeps, RequestContext } from "./ports.js";
import { bookedCountBySlot, generateForRule } from "./schedule-generation.js";

export interface ClinicTimeOffView extends ClinicTimeOff {
  bookedSlotCount: number;
}

export interface ClinicTimeOffBookedSlot {
  slotId: string;
  kind: ClinicSlotKind;
  startsAt: Date;
  durationMinutes: number;
  bookedCount: number;
}

export interface ClinicTimeOffResult {
  timeOff: ClinicTimeOffView;
  removedSlots: number;
  bookedSlots: ClinicTimeOffBookedSlot[];
}

/** Horários futuros do profissional no bloqueio com marcações ativas (sem dados do paciente). */
async function bookedSlotsIn<Trx>(deps: ClinicsDeps<Trx>, trx: Trx, timeOff: ClinicTimeOff): Promise<ClinicTimeOffBookedSlot[]> {
  const now = deps.clock.now();
  const slots = (await deps.clinicSlotsRepo.listByProfessional(trx, timeOff.professionalId, { endsAfter: timeOff.startsAt, startsBefore: timeOff.endsAt })).filter(
    (slot) => slot.startsAt.getTime() > now.getTime() && slotIntersectsTimeOff(slot, timeOff),
  );
  const booked = await bookedCountBySlot(deps, trx, slots);
  return slots
    .filter((slot) => (booked.get(slot.id) ?? 0) > 0)
    .map((slot) => ({ slotId: slot.id, kind: slot.kind, startsAt: slot.startsAt, durationMinutes: slot.durationMinutes, bookedCount: booked.get(slot.id) ?? 0 }));
}

export function createListClinicTimeOffUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listClinicTimeOff(actor: ClinicPortalActor, query: { professionalId?: string; from?: Date; to?: Date }): Promise<ClinicTimeOffView[]> {
    return deps.withTransaction(async (trx) => {
      const items = await deps.timeOffRepo.list(trx, actor.clinicId, {
        ...(query.professionalId ? { professionalId: query.professionalId } : {}),
        endsAfter: query.from ?? deps.clock.now(),
        ...(query.to ? { startsBefore: query.to } : {}),
      });
      const views: ClinicTimeOffView[] = [];
      for (const item of items) {
        views.push({ ...item, bookedSlotCount: (await bookedSlotsIn(deps, trx, item)).length });
      }
      return views;
    });
  };
}

export interface CreateClinicTimeOffInput {
  professionalId: string;
  startsAt: string;
  endsAt: string;
  reason?: unknown;
}

/** `POST /clinic-portal/time-off`. */
export function createCreateClinicTimeOffUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function createClinicTimeOff(actor: ClinicPortalActor, input: CreateClinicTimeOffInput, context: RequestContext): Promise<ClinicTimeOffResult> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const now = deps.clock.now();
    assertValidTimeOffRange(startsAt, endsAt, now);
    const reason = normalizeTimeOffReason(input.reason);
    return deps.withTransaction(async (trx) => {
      const professional = await deps.catalogRepo.lockProfessional(trx, actor.clinicId, input.professionalId);
      if (!professional) {
        throw new NotFoundError({ detail: "Profissional não encontrado." });
      }
      const timeOff = await deps.timeOffRepo.insert(trx, {
        id: newId(),
        clinicId: actor.clinicId,
        professionalId: professional.id,
        startsAt,
        endsAt,
        reason,
        createdByClinicAccountId: actor.clinicAccountId,
        createdAt: now,
      });
      const inRange = (await deps.clinicSlotsRepo.listByProfessional(trx, professional.id, { endsAfter: startsAt, startsBefore: endsAt })).filter(
        (slot) => slot.startsAt.getTime() > now.getTime() && slotIntersectsTimeOff(slot, timeOff),
      );
      // Bloqueia os horários antes de contar as marcações (serializa com reservas).
      const locked = inRange.length === 0 ? [] : await deps.clinicSlotsRepo.lockMany(trx, inRange.map((slot) => slot.id));
      const booked = await bookedCountBySlot(deps, trx, locked);
      const free = locked.filter((slot) => (booked.get(slot.id) ?? 0) === 0);
      await deps.clinicSlotsRepo.deleteMany(trx, free.map((slot) => slot.id));
      const bookedSlots = locked
        .filter((slot) => (booked.get(slot.id) ?? 0) > 0)
        .map((slot) => ({ slotId: slot.id, kind: slot.kind, startsAt: slot.startsAt, durationMinutes: slot.durationMinutes, bookedCount: booked.get(slot.id) ?? 0 }));

      await auditClinicWrite(deps, trx, actor, context, {
        action: "CLINIC_TIME_OFF_CREATE",
        resourceType: "ClinicTimeOff",
        resourceId: timeOff.id,
        metadata: { professionalId: professional.id, removedSlots: free.length, bookedSlots: bookedSlots.length },
      });
      return { timeOff: { ...timeOff, bookedSlotCount: bookedSlots.length }, removedSlots: free.length, bookedSlots };
    });
  };
}

/** `DELETE /clinic-portal/time-off/{id}`: regenera o intervalo das regras ativas do profissional. */
export function createDeleteClinicTimeOffUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function deleteClinicTimeOff(actor: ClinicPortalActor, timeOffId: string, context: RequestContext): Promise<ScheduleGeneration> {
    return deps.withTransaction(async (trx) => {
      const found = await deps.timeOffRepo.findById(trx, actor.clinicId, timeOffId);
      if (!found) {
        throw new NotFoundError({ detail: "Bloqueio não encontrado." });
      }
      await deps.catalogRepo.lockProfessional(trx, actor.clinicId, found.professionalId);
      const timeOff = await deps.timeOffRepo.findById(trx, actor.clinicId, timeOffId);
      if (!timeOff) {
        throw new NotFoundError({ detail: "Bloqueio não encontrado." });
      }
      await deps.timeOffRepo.delete(trx, timeOffId);
      let generation = emptyGeneration();
      for (const rule of await deps.scheduleRulesRepo.listActiveByProfessional(trx, timeOff.professionalId)) {
        generation = addGeneration(generation, await generateForRule(deps, trx, rule, { from: timeOff.startsAt, to: timeOff.endsAt }));
      }
      await auditClinicWrite(deps, trx, actor, context, {
        action: "CLINIC_TIME_OFF_DELETE",
        resourceType: "ClinicTimeOff",
        resourceId: timeOffId,
        metadata: { professionalId: timeOff.professionalId, ...generation },
      });
      return generation;
    });
  };
}
