// Ocorrência de toma (entities.md "DoseOccurrence", categoria C4) e a janela pura das suas ações
// (BR-MED-03/04, Q2, ST2/ST3, state-machines.md). Sem I/O: recebe `now`/`timeZone` já resolvidos
// por quem chama (`application`, via `Clock`/`access.getEffectiveTimezone`).
import { addCalendarDays, localDateTimeOf, zonedTimeToUtc } from "./schedule.js";

export type DoseStatus = "PENDING" | "TAKEN" | "NOT_TAKEN" | "UNCONFIRMED";

export interface DoseOccurrence {
  id: string;
  familyId: string;
  memberId: string;
  planId: string;
  medicationName: string;
  dosage: string;
  scheduledAt: Date;
  status: DoseStatus;
  actedAt?: Date;
  actedByUserId?: string;
  note?: string;
  generationVersion: number;
  createdAt: Date;
}

/** BR-MED-03/Q2: passadas 2h sem ação, PENDING -> UNCONFIRMED (job do sistema, `medications.mark-unconfirmed`). */
export const UNCONFIRMED_THRESHOLD_MS = 2 * 60 * 60 * 1000;
/** ST3: uma toma futura só pode ser confirmada/marcada até 1h antes do horário previsto. */
export const FUTURE_ACTION_GUARD_MS = 60 * 60 * 1000;
/** ST2: janela de correção (TAKEN<->NOT_TAKEN) de uma toma já registada. */
export const CORRECTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isPastUnconfirmedThreshold(scheduledAt: Date, now: Date): boolean {
  return now.getTime() - scheduledAt.getTime() >= UNCONFIRMED_THRESHOLD_MS;
}

/** ST3: não é possível agir sobre uma toma mais de 1h antes do horário previsto. */
export function isTooFarInFuture(scheduledAt: Date, now: Date): boolean {
  return scheduledAt.getTime() - now.getTime() > FUTURE_ACTION_GUARD_MS;
}

/** Q2: confirmação (tardia) permitida até ao fim do dia seguinte ao horário, no fuso efetivo do sujeito. */
export function confirmationDeadline(scheduledAt: Date, timeZone: string): Date {
  const scheduledLocalDay = localDateTimeOf(scheduledAt, timeZone);
  const nextDay = addCalendarDays(scheduledLocalDay, 1);
  const startOfDayAfterNext = zonedTimeToUtc({ ...addCalendarDays(nextDay, 1), hour: 0, minute: 0 }, timeZone).utc;
  return new Date(startOfDayAfterNext.getTime() - 1);
}

/** ST2: 7 dias a partir do horário previsto (janela plana, sem necessidade de limites de dia local). */
export function correctionDeadline(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() + CORRECTION_WINDOW_MS);
}

export type DoseActionDenialReason = "DOSE_IN_FUTURE" | "DOSE_WINDOW_EXPIRED";

/** Confirmar (`taken`) ou marcar "não tomada" (`not-taken`) uma toma PENDING/UNCONFIRMED (UC-MED-05/06). */
export function canActOnDose(
  scheduledAt: Date,
  now: Date,
  timeZone: string,
): { allowed: true } | { allowed: false; reason: DoseActionDenialReason } {
  if (isTooFarInFuture(scheduledAt, now)) {
    return { allowed: false, reason: "DOSE_IN_FUTURE" };
  }
  if (now.getTime() > confirmationDeadline(scheduledAt, timeZone).getTime()) {
    return { allowed: false, reason: "DOSE_WINDOW_EXPIRED" };
  }
  return { allowed: true };
}

/** Corrigir uma toma já registada (TAKEN<->NOT_TAKEN, UC-MED-07/ST2). */
export function canCorrectDose(scheduledAt: Date, now: Date): { allowed: true } | { allowed: false; reason: "DOSE_WINDOW_EXPIRED" } {
  if (now.getTime() > correctionDeadline(scheduledAt).getTime()) {
    return { allowed: false, reason: "DOSE_WINDOW_EXPIRED" };
  }
  return { allowed: true };
}
