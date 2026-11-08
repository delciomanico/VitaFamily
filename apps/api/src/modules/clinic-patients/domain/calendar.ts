// Calendário por profissional (BR-CLN-23): janela, itens e horários livres. Puro, sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";

export const CALENDAR_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
export const CALENDAR_MAX_ITEMS = 2000;

export type CalendarEntryStatus = "REQUESTED" | "SCHEDULED" | "REJECTED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";

export interface CalendarEntry {
  id: string;
  source: "VITA" | "MANUAL";
  kind: "APPOINTMENT" | "EXAM";
  status: CalendarEntryStatus;
  startsAt: Date;
  endsAt: Date;
  professionalId: string | null;
  professionalName: string | null;
  specialty: string | null;
  patientName: string;
  clinicPatientId: string | null;
  slotId: string | null;
  /** M14 Q (BR-CLN-25/28): nulos nos exames. */
  confirmationStatus: "PENDING" | "CONFIRMED" | "DECLINED" | null;
  dayState: "SCHEDULED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW" | "CANCELLED" | "REQUESTED" | "REJECTED" | null;
  arrivedAt: Date | null;
  waitingMinutes: number | null;
}

/** BR-CLN-28: `ARRIVED`/`IN_PROGRESS` derivam de `arrivedAt`/`startedAt` só enquanto a marcação é `SCHEDULED`. */
export function calendarDayState(status: CalendarEntryStatus, arrivedAt?: Date, startedAt?: Date): NonNullable<CalendarEntry["dayState"]> {
  if (status !== "SCHEDULED") return status;
  if (startedAt) return "IN_PROGRESS";
  return arrivedAt ? "ARRIVED" : "SCHEDULED";
}

export interface CalendarFreeSlot {
  slotId: string;
  kind: "APPOINTMENT" | "EXAM";
  startsAt: Date;
  endsAt: Date;
  professionalId: string | null;
  professionalName: string | null;
  specialty: string;
  remaining: number;
}

export interface CalendarWindow {
  from: Date;
  to: Date;
}

/** `to > from` e janela ≤ 31 dias, senão `VALIDATION_ERROR`. */
export function parseCalendarWindow(fromRaw: unknown, toRaw: unknown): CalendarWindow {
  const from = typeof fromRaw === "string" ? new Date(fromRaw) : new Date(Number.NaN);
  const to = typeof toRaw === "string" ? new Date(toRaw) : new Date(Number.NaN);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError([{ field: "from", message: "from/to têm de ser data/hora válidas" }], { detail: "Janela inválida." });
  }
  if (to.getTime() <= from.getTime()) {
    throw new ValidationError([{ field: "to", message: "tem de ser posterior a from" }], { detail: "Janela inválida." });
  }
  if (to.getTime() - from.getTime() > CALENDAR_MAX_WINDOW_MS) {
    throw new ValidationError([{ field: "to", message: "janela máxima de 31 dias" }], { detail: "Janela demasiado grande." });
  }
  return { from, to };
}

export function assertWithinItemLimit(count: number): void {
  if (count > CALENDAR_MAX_ITEMS) {
    throw new ValidationError([{ field: "to", message: "demasiados itens; use uma janela mais curta" }], { detail: "Janela com demasiados itens." });
  }
}

/** Ordem do calendário: início, depois id (estável). */
export function compareEntries(a: Pick<CalendarEntry, "startsAt" | "id">, b: Pick<CalendarEntry, "startsAt" | "id">): number {
  return a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id);
}

/** Pesquisa de marcações (BR-CLN-22): futuras primeiro (por início crescente), depois passadas (mais recentes primeiro). */
export function orderSearchBookings<T extends Pick<CalendarEntry, "startsAt" | "id">>(entries: T[], now: Date): T[] {
  const future = entries.filter((e) => e.startsAt.getTime() >= now.getTime()).sort(compareEntries);
  const past = entries.filter((e) => e.startsAt.getTime() < now.getTime()).sort((a, b) => compareEntries(b, a));
  return [...future, ...past];
}

export function bookingMatches(entry: Pick<CalendarEntry, "patientName" | "specialty" | "professionalName">, normalizedQ: string, normalize: (value: string) => string): boolean {
  return [entry.patientName, entry.specialty, entry.professionalName].some((value) => value !== null && normalize(value).includes(normalizedQ));
}
