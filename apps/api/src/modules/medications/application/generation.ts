// Geração/recálculo de ocorrências de um plano (DM5/architecture.md: "janela móvel de 14 dias...
// recalculadas quando o plano/fuso muda"; BR-RX-05/BR-MED-08: só afeta o futuro PENDING, nunca
// reescreve o passado nem duplica/perde doses). Partilhado por `create-plan`, `update-plan`,
// `set-plan-status` e os jobs do worker — um único sítio com esta lógica (conventions.md §2).
import { newId } from "../../../platform/ids/index.js";
import { generateOccurrences, type Schedule } from "../domain/schedule.js";
import type { MedicationPlan } from "../domain/medication-plan.js";
import type { DoseOccurrencesRepository, NewDoseOccurrenceRecord } from "./ports.js";

/** DM5/architecture.md: ocorrências materializadas numa janela móvel de 14 dias. */
export const GENERATION_WINDOW_DAYS = 14;

function scheduleOf(plan: MedicationPlan): Schedule {
  if (plan.scheduleType === "FIXED_TIMES") {
    return { scheduleType: "FIXED_TIMES", times: plan.times ?? [], daysOfWeek: plan.daysOfWeek ?? [] };
  }
  return { scheduleType: "INTERVAL", intervalHours: plan.intervalHours ?? 1, startAt: plan.startAt };
}

/**
 * Regenera as ocorrências futuras PENDING de `plan` para a janela [now, now+14d] (ou até
 * `plan.endAt`, se anterior): insere as que faltam, remove as PENDING que já não fazem parte do
 * novo desenho — nunca toca em TAKEN/NOT_TAKEN/UNCONFIRMED (histórico) nem em ocorrências passadas.
 * Chamado com o plano já ACTIVE (quem chama decide se um plano ENDED deve ser regenerado).
 */
export async function regeneratePlanOccurrences<Trx>(
  dosesRepo: DoseOccurrencesRepository<Trx>,
  trx: Trx,
  plan: MedicationPlan,
  now: Date,
  timeZone: string,
): Promise<void> {
  const windowEnd = new Date(now.getTime() + GENERATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const desired = generateOccurrences(scheduleOf(plan), { from: now, to: windowEnd }, plan.startAt, plan.endAt ?? null, timeZone);

  const existing = await dosesRepo.listFutureByPlan(trx, plan.id, now);
  const existingAt = new Set(existing.map((occurrence) => occurrence.scheduledAt.getTime()));

  const toInsert: NewDoseOccurrenceRecord[] = desired
    .filter((scheduledAt) => !existingAt.has(scheduledAt.getTime()))
    .map((scheduledAt) => ({
      id: newId(),
      familyId: plan.familyId,
      memberId: plan.memberId,
      planId: plan.id,
      scheduledAt,
      generationVersion: 1,
      createdAt: now,
    }));

  if (toInsert.length > 0) {
    await dosesRepo.insertMany(trx, toInsert);
  }
  // Remove PENDING futuras que já não fazem parte do novo desenho (horários/duração alterados).
  await dosesRepo.deletePendingNotIn(trx, plan.id, now, desired);
}

/** Terminar/eliminar um plano: remove toda a agenda futura PENDING (histórico mantém-se). */
export async function clearFuturePendingOccurrences<Trx>(
  dosesRepo: DoseOccurrencesRepository<Trx>,
  trx: Trx,
  planId: string,
  now: Date,
): Promise<void> {
  await dosesRepo.deleteAllFuturePending(trx, planId, now);
}
