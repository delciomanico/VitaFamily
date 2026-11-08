// Confirmação por telefone, fluxo do dia e retorno de uma VISITA manual (M14 Q, BR-CLN-25..30). Mesmas regras que
// `appointments/domain/day-flow.ts` (duplicado de propósito: módulos só se importam pela raiz, conventions.md §1);
// erros `INVALID_STATE_TRANSITION`. Sem I/O.
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { addDaysIso, addMonthsIso, diffDaysIso, localDateIso } from "../../../platform/time/index.js";
import type { ClinicVisit, ClinicVisitStatus } from "./clinic-visit.js";

export type VisitDayState = "SCHEDULED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW" | "CANCELLED";

function invalid(detail: string): DomainError {
  return new DomainError("INVALID_STATE_TRANSITION", { detail });
}

type Target = Pick<ClinicVisit, "status" | "scheduledAt" | "confirmationStatus" | "arrivedAt" | "startedAt">;

export function deriveVisitDayState(status: ClinicVisitStatus, arrivedAt?: Date, startedAt?: Date): VisitDayState {
  if (status !== "SCHEDULED") return status;
  if (startedAt) return "IN_PROGRESS";
  return arrivedAt ? "ARRIVED" : "SCHEDULED";
}

export function visitWaitingMinutes(arrivedAt: Date | undefined, startedAt: Date | undefined, now: Date): number | null {
  if (!arrivedAt) return null;
  return Math.max(0, Math.floor(((startedAt ?? now).getTime() - arrivedAt.getTime()) / 60_000));
}

function assertSameLocalDay(scheduledAt: Date, now: Date): void {
  if (localDateIso(scheduledAt) !== localDateIso(now)) throw invalid("Só é possível no dia da marcação.");
}

/** BR-CLN-27: só `SCHEDULED` e futura. Devolve `false` se já estava confirmada. */
export function planVisitConfirmation(target: Target, now: Date): boolean {
  if (target.status !== "SCHEDULED" || target.scheduledAt.getTime() <= now.getTime()) {
    throw invalid("Só marcações agendadas e futuras podem ser confirmadas.");
  }
  return target.confirmationStatus !== "CONFIRMED";
}

export function planVisitArrive(target: Target, now: Date): { status: ClinicVisitStatus; arrivedAt: Date; changed: boolean } {
  if (target.status !== "SCHEDULED" && target.status !== "NO_SHOW") throw invalid("Só marcações agendadas (ou com falta registada) podem ter chegada.");
  assertSameLocalDay(target.scheduledAt, now);
  return { status: "SCHEDULED", arrivedAt: target.arrivedAt ?? now, changed: target.status === "NO_SHOW" || !target.arrivedAt };
}

export function planVisitStart(target: Target, now: Date): { arrivedAt: Date; startedAt: Date; changed: boolean } {
  if (target.status !== "SCHEDULED") throw invalid("Só marcações agendadas podem ser iniciadas.");
  assertSameLocalDay(target.scheduledAt, now);
  return { arrivedAt: target.arrivedAt ?? now, startedAt: target.startedAt ?? now, changed: !target.startedAt };
}

export function planVisitNoShow(target: Target, now: Date): boolean {
  if (target.status === "NO_SHOW") return false;
  if (target.status !== "SCHEDULED" || target.scheduledAt.getTime() > now.getTime() || target.startedAt) {
    throw invalid("Só marcações agendadas, já na hora e sem atendimento iniciado podem ter falta.");
  }
  return true;
}

export const FOLLOW_UP_MIN = 1;
export const FOLLOW_UP_MAX = 24;
/** BR-CLN-30: `patientNotified` (consulta Vita) = hoje ≥ `dueOn` − 7 dias. */
export const FOLLOW_UP_LEAD_DAYS = 7;

export function computeVisitFollowUpDueOn(target: Pick<ClinicVisit, "status" | "scheduledAt">, amount: unknown, unit: unknown): string {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < FOLLOW_UP_MIN || amount > FOLLOW_UP_MAX) {
    throw new ValidationError([{ field: "amount", message: `inteiro entre ${String(FOLLOW_UP_MIN)} e ${String(FOLLOW_UP_MAX)}` }], { detail: "Quantidade de retorno inválida." });
  }
  if (unit !== "WEEKS" && unit !== "MONTHS") {
    throw new ValidationError([{ field: "unit", message: "WEEKS ou MONTHS" }], { detail: "Unidade de retorno inválida." });
  }
  if (target.status !== "COMPLETED") throw invalid("Só marcações concluídas podem ter retorno.");
  const day = localDateIso(target.scheduledAt);
  return unit === "WEEKS" ? addDaysIso(day, amount * 7) : addMonthsIso(day, amount);
}

/** `true` se o alerta de retorno de uma consulta Vita já é devido hoje (derivado; BR-CLN-30). */
export function isFollowUpNotified(source: "VITA" | "MANUAL", dueOn: string, now: Date): boolean {
  return source === "VITA" && diffDaysIso(localDateIso(now), dueOn) <= FOLLOW_UP_LEAD_DAYS;
}
