// Geração e reconciliação de `ClinicSlot` por regra (M14 a2, BR-CLN-12/13/14/15) + job diário
// `clinics.generate-schedule` (auditado como SYSTEM, só contagens). Quem chama já bloqueou a linha do
// profissional (`catalogRepo.lockProfessional`): a ordem fixa é profissional -> horários (schema.md §3a).
import { newId } from "../../../platform/ids/index.js";
import { computeSlotOccupancy, type ClinicSlot, type SlotBookingCounts } from "../domain/clinic-slot.js";
import {
  addGeneration,
  emptyGeneration,
  generateRuleCandidates,
  generationWindow,
  planGeneration,
  staleRuleSlots,
  type ClinicScheduleRule,
  type ScheduleGeneration,
} from "../domain/clinic-schedule.js";
import type { ClinicsDeps } from "./ports.js";

export type GenerationDeps<Trx> = Pick<ClinicsDeps<Trx>, "clock" | "catalogRepo" | "clinicSlotsRepo" | "timeOffRepo" | "scheduleHorizonWeeks">;
export type ReconcileDeps<Trx> = GenerationDeps<Trx> & Pick<ClinicsDeps<Trx>, "slotOccupancy">;

/** Marcações ativas por horário (consultas `REQUESTED`/`SCHEDULED` e exames `SCHEDULED`, via porta). */
export async function bookedCountBySlot<Trx>(deps: Pick<ClinicsDeps<Trx>, "slotOccupancy">, trx: Trx, slots: ClinicSlot[]): Promise<Map<string, number>> {
  const counts = new Map<string, SlotBookingCounts>();
  const rows = slots.length === 0 ? [] : await deps.slotOccupancy.countActiveBySlot(trx, slots.map((slot) => slot.id));
  for (const row of rows) {
    const current = counts.get(row.slotId) ?? { requested: 0, scheduled: 0 };
    counts.set(row.slotId, { requested: current.requested + row.requested, scheduled: current.scheduled + row.scheduled });
  }
  return new Map(slots.map((slot) => [slot.id, computeSlotOccupancy(slot, counts.get(slot.id) ?? { requested: 0, scheduled: 0 }).bookedCount]));
}

/**
 * BR-CLN-12: cria, de forma idempotente, os horários que a regra prevê na janela (ignora passado,
 * bloqueios e sobreposições). Regra/profissional/serviço inativos => não gera. `range` limita aos horários
 * que começam em `[from, to)` (remoção de um bloqueio).
 */
export async function generateForRule<Trx>(
  deps: GenerationDeps<Trx>,
  trx: Trx,
  rule: ClinicScheduleRule,
  range?: { from: Date; to: Date },
): Promise<ScheduleGeneration> {
  const result = emptyGeneration();
  if (!rule.active) {
    return result;
  }
  const professional = await deps.catalogRepo.findProfessional(trx, rule.clinicId, rule.professionalId);
  const service = await deps.catalogRepo.findServiceType(trx, rule.clinicId, rule.serviceTypeId);
  if (!professional?.active || !service?.active) {
    return result;
  }
  const now = deps.clock.now();
  let candidates = generateRuleCandidates(rule, service.durationMinutes, generationWindow(now, deps.scheduleHorizonWeeks), now);
  if (range) {
    candidates = candidates.filter((c) => c.startsAt.getTime() >= range.from.getTime() && c.startsAt.getTime() < range.to.getTime());
  }
  const first = candidates[0];
  const last = candidates.at(-1);
  if (!first || !last) {
    return result;
  }
  const existing = await deps.clinicSlotsRepo.listByProfessional(trx, rule.professionalId, { endsAfter: first.startsAt, startsBefore: last.endsAt });
  const timeOffs = await deps.timeOffRepo.listOverlapping(trx, rule.professionalId, first.startsAt, last.endsAt);
  const plan = planGeneration(rule.id, candidates, existing, timeOffs);

  const records = plan.toCreate.map((candidate) => ({
    id: newId(),
    clinicId: rule.clinicId,
    kind: service.kind,
    specialty: service.name,
    professionalName: professional.name,
    startsAt: candidate.startsAt,
    durationMinutes: service.durationMinutes,
    capacity: service.kind === "EXAM" ? rule.capacity : 1,
    professionalId: professional.id,
    serviceTypeId: service.id,
    scheduleRuleId: rule.id,
    createdAt: now,
  }));
  const created = records.length === 0 ? [] : await deps.clinicSlotsRepo.insertManyIgnoringConflicts(trx, records);
  // A exclusão/unicidade na BD é a rede final: o que o planeamento previa criar e a BD recusou é sobreposição.
  return {
    created: created.length,
    unchanged: plan.unchanged,
    removed: 0,
    skippedOverlap: plan.skippedOverlap + (records.length - created.length),
    skippedTimeOff: plan.skippedTimeOff,
    keptBooked: 0,
  };
}

/**
 * BR-CLN-15: remove os horários futuros e LIVRES da regra que já não correspondem (todos, se a regra,
 * o profissional ou o serviço estiverem inativos), mantém os marcados (`keptBooked`) e gera os em falta.
 * Os horários são bloqueados antes de contar as marcações (serializa com reservas, BR-APT-11).
 */
export async function reconcileRule<Trx>(deps: ReconcileDeps<Trx>, trx: Trx, rule: ClinicScheduleRule): Promise<ScheduleGeneration> {
  const now = deps.clock.now();
  const professional = await deps.catalogRepo.findProfessional(trx, rule.clinicId, rule.professionalId);
  const service = await deps.catalogRepo.findServiceType(trx, rule.clinicId, rule.serviceTypeId);
  const desired = rule.active && professional?.active === true && service?.active === true ? generateRuleCandidates(rule, service.durationMinutes, generationWindow(now, deps.scheduleHorizonWeeks), now) : [];

  const future = await deps.clinicSlotsRepo.listFutureByRule(trx, rule.id, now);
  const stale = staleRuleSlots(future, desired);
  let removed = 0;
  let keptBooked = 0;
  if (stale.length > 0) {
    const locked = await deps.clinicSlotsRepo.lockMany(trx, stale.map((slot) => slot.id));
    const booked = await bookedCountBySlot(deps, trx, locked);
    const free = locked.filter((slot) => (booked.get(slot.id) ?? 0) === 0);
    keptBooked = locked.length - free.length;
    removed = free.length;
    await deps.clinicSlotsRepo.deleteMany(trx, free.map((slot) => slot.id));
  }
  const generation = await generateForRule(deps, trx, rule);
  return { ...generation, removed, keptBooked };
}

export type ScheduleJobDeps<Trx> = GenerationDeps<Trx> &
  Pick<ClinicsDeps<Trx>, "withTransaction" | "audit" | "scheduleRulesRepo"> & { logger: Pick<ClinicsDeps<Trx>["logger"], "warn"> };

export interface ScheduleJobResult extends ScheduleGeneration {
  rules: number;
  failedRules: number;
}

/**
 * Job diário `clinics.generate-schedule` (modules.md §5, BR-CLN-12): para cada regra ativa de
 * profissional e serviço ativos, gera a janela rolante. Idempotente (correr duas vezes seguidas dá
 * `created = 0` na segunda). Uma transação por regra (uma falha não impede as restantes); uma entrada de
 * auditoria `SYSTEM` por execução, só com contagens.
 */
export function createGenerateScheduleJobUseCase<Trx>(deps: ScheduleJobDeps<Trx>) {
  return async function generateSchedule(): Promise<ScheduleJobResult> {
    const rules = await deps.withTransaction((trx) => deps.scheduleRulesRepo.listActiveForGeneration(trx));
    let total = emptyGeneration();
    let failedRules = 0;
    for (const rule of rules) {
      try {
        const generation = await deps.withTransaction(async (trx) => {
          const professional = await deps.catalogRepo.lockProfessional(trx, rule.clinicId, rule.professionalId);
          const current = professional ? await deps.scheduleRulesRepo.findById(trx, rule.clinicId, rule.id) : null;
          return current ? generateForRule(deps, trx, current) : emptyGeneration();
        });
        total = addGeneration(total, generation);
      } catch (error) {
        failedRules += 1;
        deps.logger.warn({ ruleId: rule.id, err: error instanceof Error ? error.message : "erro" }, "clinics_generate_schedule_rule_failed");
      }
    }
    const result: ScheduleJobResult = { ...total, rules: rules.length, failedRules };
    await deps.withTransaction((trx) =>
      deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "SYSTEM",
        action: "CLINIC_SCHEDULE_GENERATE",
        resourceType: "ClinicScheduleRule",
        result: failedRules === 0 ? "SUCCESS" : "FAILURE",
        requestId: newId(),
        metadata: { ...result },
      }),
    );
    return result;
  };
}
