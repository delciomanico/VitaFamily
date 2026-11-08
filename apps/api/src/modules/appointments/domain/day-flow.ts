// Confirmação ativa, fluxo do dia e retorno de uma consulta (M14 Q, BR-CLN-25..30, state-machines.md "Confirmação e
// fluxo do dia"). Regras puras, sem I/O. `ARRIVED`/`IN_PROGRESS` são derivados (`arrivedAt`/`startedAt`), nunca
// estados Vita. Duplicado de propósito em `clinic-patients/domain/day-flow.ts` (as visitas): módulos só se importam
// pela raiz (conventions.md §1) e a aritmética de datas vem de `platform/time`.
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { addDaysIso, addMonthsIso, localDateIso } from "../../../platform/time/index.js";
import type { AppointmentStatus, ConfirmationStatus } from "./appointment.js";

export type DayState = "SCHEDULED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW" | "CANCELLED" | "REQUESTED" | "REJECTED";
export type FollowUpUnit = "WEEKS" | "MONTHS";

export interface DayFlowTarget {
  status: AppointmentStatus;
  scheduledAt: Date;
  confirmationStatus: ConfirmationStatus;
  arrivedAt?: Date | undefined;
  startedAt?: Date | undefined;
}

function invalid(detail: string): DomainError {
  return new DomainError("INVALID_STATE_TRANSITION", { detail });
}

/** BR-CLN-28: `SCHEDULED` sem chegada → `ARRIVED` (com `arrivedAt`) → `IN_PROGRESS` (com `startedAt`); os restantes mantêm-se. */
export function deriveDayState(status: AppointmentStatus, arrivedAt?: Date, startedAt?: Date): DayState {
  if (status !== "SCHEDULED") return status;
  if (startedAt) return "IN_PROGRESS";
  return arrivedAt ? "ARRIVED" : "SCHEDULED";
}

/** BR-CLN-28: minutos inteiros (≥ 0) de `arrivedAt` até `startedAt` (ou agora); nulo sem chegada. Não é guardada. */
export function waitingMinutes(arrivedAt: Date | undefined, startedAt: Date | undefined, now: Date): number | null {
  if (!arrivedAt) return null;
  const end = startedAt ?? now;
  return Math.max(0, Math.floor((end.getTime() - arrivedAt.getTime()) / 60_000));
}

function assertSameLocalDay(scheduledAt: Date, now: Date): void {
  if (localDateIso(scheduledAt) !== localDateIso(now)) {
    throw invalid("Só é possível no dia da marcação.");
  }
}

/** BR-CLN-27: "confirmado por telefone" só em `SCHEDULED` e futura. Devolve `false` se já estava confirmada (idempotente). */
export function planPhoneConfirmation(target: DayFlowTarget, now: Date): boolean {
  if (target.status !== "SCHEDULED" || target.scheduledAt.getTime() <= now.getTime()) {
    throw invalid("Só marcações agendadas e futuras podem ser confirmadas.");
  }
  return target.confirmationStatus !== "CONFIRMED";
}

export interface ArrivePlan {
  status: AppointmentStatus;
  arrivedAt: Date;
  changed: boolean;
}

/** BR-CLN-28 "Chegou": `SCHEDULED` ou `NO_SHOW` (chegada tardia → `SCHEDULED`), no dia local; o primeiro `arrivedAt` prevalece. */
export function planArrive(target: DayFlowTarget, now: Date): ArrivePlan {
  if (target.status !== "SCHEDULED" && target.status !== "NO_SHOW") {
    throw invalid("Só marcações agendadas (ou com falta registada) podem ter chegada.");
  }
  assertSameLocalDay(target.scheduledAt, now);
  const changed = target.status === "NO_SHOW" || !target.arrivedAt;
  return { status: "SCHEDULED", arrivedAt: target.arrivedAt ?? now, changed };
}

export interface StartPlan {
  arrivedAt: Date;
  startedAt: Date;
  changed: boolean;
}

/** BR-CLN-28 "Iniciar": `SCHEDULED` no dia local; define `startedAt` e, se faltar, `arrivedAt`. O estado Vita não muda. */
export function planStart(target: DayFlowTarget, now: Date): StartPlan {
  if (target.status !== "SCHEDULED") {
    throw invalid("Só marcações agendadas podem ser iniciadas.");
  }
  assertSameLocalDay(target.scheduledAt, now);
  return { arrivedAt: target.arrivedAt ?? now, startedAt: target.startedAt ?? now, changed: !target.startedAt };
}

/** BR-CLN-28 "Faltou": `SCHEDULED`, `scheduledAt ≤ agora`, sem `startedAt` → `NO_SHOW`. Devolve `false` se já era `NO_SHOW`. */
export function planNoShow(target: DayFlowTarget, now: Date): boolean {
  if (target.status === "NO_SHOW") return false;
  if (target.status !== "SCHEDULED" || target.scheduledAt.getTime() > now.getTime() || target.startedAt) {
    throw invalid("Só marcações agendadas, já na hora e sem atendimento iniciado podem ter falta.");
  }
  return true;
}

export const FOLLOW_UP_MIN = 1;
export const FOLLOW_UP_MAX = 24;
/** BR-CLN-30: o lembrete de retorno sai 7 dias antes de `followUpDueOn`. */
export const FOLLOW_UP_LEAD_DAYS = 7;

/** BR-CLN-30: só `COMPLETED`; `followUpDueOn` = dia local de `scheduledAt` + N semanas/meses (dia limitado ao fim do mês). */
export function computeFollowUpDueOn(target: Pick<DayFlowTarget, "status" | "scheduledAt">, amount: unknown, unit: unknown): string {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < FOLLOW_UP_MIN || amount > FOLLOW_UP_MAX) {
    throw new ValidationError([{ field: "amount", message: `inteiro entre ${String(FOLLOW_UP_MIN)} e ${String(FOLLOW_UP_MAX)}` }], { detail: "Quantidade de retorno inválida." });
  }
  if (unit !== "WEEKS" && unit !== "MONTHS") {
    throw new ValidationError([{ field: "unit", message: "WEEKS ou MONTHS" }], { detail: "Unidade de retorno inválida." });
  }
  if (target.status !== "COMPLETED") {
    throw invalid("Só marcações concluídas podem ter retorno.");
  }
  const day = localDateIso(target.scheduledAt);
  return unit === "WEEKS" ? addDaysIso(day, amount * 7) : addMonthsIso(day, amount);
}
