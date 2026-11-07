// Regras de horário semanais, geração de horários consecutivos, bloqueios e planeamento idempotente
// (M14 a2, BR-CLN-12..15, schema.md §3a). Regras puras, sem I/O: o fuso é fixo (`CLINIC_TIMEZONE`).
import { ValidationError } from "../../../platform/errors/index.js";
import { assertCapacityAllowedForKind, assertValidCapacity, intervalsOverlap, slotEndsAt, type ClinicSlot, type ClinicSlotKind } from "./clinic-slot.js";
import {
  addLocalDays,
  compareLocalDates,
  isoWeekdayOf,
  localDateOf,
  parseLocalDate,
  parseLocalTime,
  zonedTimeToUtc,
  type LocalDate,
} from "./clinic-slot-time.js";

export const MAX_CLINIC_SCHEDULE_RULES = 200;
/** Janela rolante (BR-CLN-12; `CLINIC_SCHEDULE_HORIZON_WEEKS`): hoje inclusive até hoje + 7 × semanas dias. */
export const DEFAULT_SCHEDULE_HORIZON_WEEKS = 8;
export const MAX_TIME_OFF_DAYS = 366;

export interface ClinicScheduleRule {
  id: string;
  clinicId: string;
  professionalId: string;
  serviceTypeId: string;
  /** ISO: 1 = segunda ... 7 = domingo. */
  weekdays: number[];
  /** `HH:mm` locais. */
  startTime: string;
  endTime: string;
  /** `AAAA-MM-DD` locais, inclusivos; nulo = aberto. */
  validFrom: string | null;
  validUntil: string | null;
  capacity: number;
  active: boolean;
}

export interface ClinicTimeOff {
  id: string;
  clinicId: string;
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  /** Nota interna: nunca em auditoria nem logs. */
  reason: string | null;
}

/** Contagens de uma geração/reconciliação (openapi `ClinicScheduleGeneration`): só números. */
export interface ScheduleGeneration {
  created: number;
  unchanged: number;
  removed: number;
  skippedOverlap: number;
  skippedTimeOff: number;
  keptBooked: number;
}

export function emptyGeneration(): ScheduleGeneration {
  return { created: 0, unchanged: 0, removed: 0, skippedOverlap: 0, skippedTimeOff: 0, keptBooked: 0 };
}

export function addGeneration(a: ScheduleGeneration, b: ScheduleGeneration): ScheduleGeneration {
  return {
    created: a.created + b.created,
    unchanged: a.unchanged + b.unchanged,
    removed: a.removed + b.removed,
    skippedOverlap: a.skippedOverlap + b.skippedOverlap,
    skippedTimeOff: a.skippedTimeOff + b.skippedTimeOff,
    keptBooked: a.keptBooked + b.keptBooked,
  };
}

function toMinutes(time: string): number {
  const { hour, minute } = parseLocalTime(time, "time");
  return hour * 60 + minute;
}

export interface RuleInput {
  weekdays: unknown;
  startTime: unknown;
  endTime: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  capacity?: unknown;
}

export interface ValidatedRuleFields {
  weekdays: number[];
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validUntil: string | null;
  capacity: number;
}

function validDay(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError([{ field, message: "esperado AAAA-MM-DD" }], { detail: "Data inválida." });
  }
  const parsed = parseLocalDate(value, field);
  // Rejeita 2026-02-31 e afins: o dia tem de existir no calendário.
  const roundTrip = addLocalDays(parsed, 0);
  if (roundTrip.year !== parsed.year || roundTrip.month !== parsed.month || roundTrip.day !== parsed.day) {
    throw new ValidationError([{ field, message: "dia inexistente" }], { detail: "Data inválida." });
  }
  return value;
}

/** BR-CLN-12: valida os campos de uma regra contra a duração e o `kind` do serviço. */
export function validateRuleFields(input: RuleInput, service: { kind: ClinicSlotKind; durationMinutes: number }): ValidatedRuleFields {
  const { weekdays } = input;
  if (!Array.isArray(weekdays) || weekdays.length < 1 || weekdays.length > 7 || weekdays.some((d) => !Number.isInteger(d) || (d as number) < 1 || (d as number) > 7) || new Set(weekdays).size !== weekdays.length) {
    throw new ValidationError([{ field: "weekdays", message: "1 a 7 dias distintos (1 = segunda ... 7 = domingo)" }], { detail: "Dias da semana inválidos." });
  }
  if (typeof input.startTime !== "string" || typeof input.endTime !== "string") {
    throw new ValidationError([{ field: "startTime", message: "esperado HH:mm" }], { detail: "Hora inválida." });
  }
  const start = toMinutes(input.startTime);
  const end = toMinutes(input.endTime);
  if (end <= start) {
    throw new ValidationError([{ field: "endTime", message: "tem de ser posterior a startTime" }], { detail: "Intervalo horário inválido." });
  }
  if (end - start < service.durationMinutes) {
    throw new ValidationError([{ field: "endTime", message: "o intervalo tem de caber pelo menos uma duração do serviço" }], { detail: "Intervalo menor que a duração do serviço." });
  }
  const validFrom = validDay(input.validFrom, "validFrom");
  const validUntil = validDay(input.validUntil, "validUntil");
  if (validFrom && validUntil && validUntil < validFrom) {
    throw new ValidationError([{ field: "validUntil", message: "não pode ser anterior a validFrom" }], { detail: "Validade inválida." });
  }
  const capacity = assertValidCapacity(typeof input.capacity === "number" ? input.capacity : undefined);
  assertCapacityAllowedForKind(service.kind, capacity);
  return { weekdays: [...(weekdays as number[])].sort((a, b) => a - b), startTime: input.startTime, endTime: input.endTime, validFrom, validUntil, capacity };
}

/** BR-CLN-13: duas regras do mesmo profissional sobrepõem-se se partilham dia da semana, horas e validade. */
export function scheduleRulesOverlap(
  a: Pick<ClinicScheduleRule, "weekdays" | "startTime" | "endTime" | "validFrom" | "validUntil">,
  b: Pick<ClinicScheduleRule, "weekdays" | "startTime" | "endTime" | "validFrom" | "validUntil">,
): boolean {
  if (!a.weekdays.some((day) => b.weekdays.includes(day))) {
    return false;
  }
  if (!(toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime))) {
    return false;
  }
  // Validade: intervalos de dias inclusivos, `null` = aberto.
  const aBeforeB = a.validUntil !== null && b.validFrom !== null && a.validUntil < b.validFrom;
  const bBeforeA = b.validUntil !== null && a.validFrom !== null && b.validUntil < a.validFrom;
  return !aBeforeB && !bBeforeA;
}

export interface GenerationWindow {
  /** Primeiro e último dia civil (inclusivos). */
  firstDay: LocalDate;
  lastDay: LocalDate;
}

/** BR-CLN-12: janela rolante a partir de "hoje" local (hoje inclusive, + 7 × semanas dias). */
export function generationWindow(now: Date, horizonWeeks: number = DEFAULT_SCHEDULE_HORIZON_WEEKS): GenerationWindow {
  const firstDay = localDateOf(now);
  return { firstDay, lastDay: addLocalDays(firstDay, horizonWeeks * 7) };
}

export interface CandidateSlot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * BR-CLN-12: horários consecutivos de `durationMinutes` desde `startTime` enquanto terminem em/antes de
 * `endTime`, nos dias da semana da regra dentro da janela e da validade. O encosto é em tempo real
 * (UTC): num dia de mudança de hora os horários nunca se sobrepõem entre si. Ignora o passado
 * (`startsAt <= now`); não considera bloqueios nem horários existentes (`planGeneration`).
 */
export function generateRuleCandidates(
  rule: Pick<ClinicScheduleRule, "weekdays" | "startTime" | "endTime" | "validFrom" | "validUntil">,
  durationMinutes: number,
  window: GenerationWindow,
  now: Date,
): CandidateSlot[] {
  const from = parseLocalTime(rule.startTime);
  const to = parseLocalTime(rule.endTime);
  const validFrom = rule.validFrom ? parseLocalDate(rule.validFrom) : null;
  const validUntil = rule.validUntil ? parseLocalDate(rule.validUntil) : null;
  const durationMs = durationMinutes * 60_000;
  const candidates: CandidateSlot[] = [];
  for (let day = window.firstDay; compareLocalDates(day, window.lastDay) <= 0; day = addLocalDays(day, 1)) {
    if (!rule.weekdays.includes(isoWeekdayOf(day))) continue;
    if (validFrom && compareLocalDates(day, validFrom) < 0) continue;
    if (validUntil && compareLocalDates(day, validUntil) > 0) continue;
    const endMs = zonedTimeToUtc({ ...day, hour: to.hour, minute: to.minute }).getTime();
    for (let cursor = zonedTimeToUtc({ ...day, hour: from.hour, minute: from.minute }).getTime(); cursor + durationMs <= endMs; cursor += durationMs) {
      if (cursor > now.getTime()) {
        candidates.push({ startsAt: new Date(cursor), endsAt: new Date(cursor + durationMs) });
      }
    }
  }
  return candidates;
}

/** BR-CLN-14: o horário intersecta o bloqueio `[startsAt, endsAt)` (semiaberto). */
export function slotIntersectsTimeOff(slot: Pick<ClinicSlot, "startsAt" | "durationMinutes">, timeOff: Pick<ClinicTimeOff, "startsAt" | "endsAt">): boolean {
  return intervalsOverlap(slot.startsAt, slotEndsAt(slot), timeOff.startsAt, timeOff.endsAt);
}

export interface GenerationPlan {
  toCreate: CandidateSlot[];
  unchanged: number;
  skippedOverlap: number;
  skippedTimeOff: number;
}

/**
 * Planeamento idempotente (BR-CLN-12/13/14): para cada candidato — já existe da própria regra
 * (`unchanged`), cai num bloqueio (`skippedTimeOff`), sobrepõe outro horário do profissional
 * (`skippedOverlap`) ou cria-se. Os criados entram no conjunto de ocupação para que dois candidatos
 * nunca se sobreponham. `existing` = horários do profissional (qualquer origem).
 */
export function planGeneration(
  ruleId: string,
  candidates: CandidateSlot[],
  existing: Pick<ClinicSlot, "startsAt" | "durationMinutes" | "scheduleRuleId">[],
  timeOffs: Pick<ClinicTimeOff, "startsAt" | "endsAt">[],
): GenerationPlan {
  const occupied = existing.map((slot) => ({ start: slot.startsAt, end: slotEndsAt(slot), ruleId: slot.scheduleRuleId }));
  const plan: GenerationPlan = { toCreate: [], unchanged: 0, skippedOverlap: 0, skippedTimeOff: 0 };
  for (const candidate of candidates) {
    if (occupied.some((o) => o.ruleId === ruleId && o.start.getTime() === candidate.startsAt.getTime())) {
      plan.unchanged += 1;
    } else if (timeOffs.some((t) => intervalsOverlap(candidate.startsAt, candidate.endsAt, t.startsAt, t.endsAt))) {
      plan.skippedTimeOff += 1;
    } else if (occupied.some((o) => intervalsOverlap(candidate.startsAt, candidate.endsAt, o.start, o.end))) {
      plan.skippedOverlap += 1;
    } else {
      plan.toCreate.push(candidate);
      occupied.push({ start: candidate.startsAt, end: candidate.endsAt, ruleId });
    }
  }
  return plan;
}

/** BR-CLN-15: horários futuros da regra que deixaram de corresponder ao que a regra prevê. */
export function staleRuleSlots<T extends Pick<ClinicSlot, "startsAt">>(futureRuleSlots: T[], desired: CandidateSlot[]): T[] {
  const desiredStarts = new Set(desired.map((c) => c.startsAt.getTime()));
  return futureRuleSlots.filter((slot) => !desiredStarts.has(slot.startsAt.getTime()));
}

/** BR-CLN-14: `endsAt > startsAt`, ≤ 366 dias, `endsAt` no futuro. */
export function assertValidTimeOffRange(startsAt: Date, endsAt: Date, now: Date): void {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new ValidationError([{ field: "startsAt", message: "data/hora inválida" }], { detail: "Intervalo de bloqueio inválido." });
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new ValidationError([{ field: "endsAt", message: "tem de ser posterior a startsAt" }], { detail: "Intervalo de bloqueio inválido." });
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_TIME_OFF_DAYS * 24 * 3600 * 1000) {
    throw new ValidationError([{ field: "endsAt", message: `no máximo ${String(MAX_TIME_OFF_DAYS)} dias` }], { detail: "Intervalo de bloqueio inválido." });
  }
  if (endsAt.getTime() <= now.getTime()) {
    throw new ValidationError([{ field: "endsAt", message: "tem de estar no futuro" }], { detail: "Intervalo de bloqueio inválido." });
  }
}

export function normalizeTimeOffReason(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length > 200) {
    throw new ValidationError([{ field: "reason", message: "máximo 200 caracteres" }], { detail: "Motivo inválido." });
  }
  return value.trim().length === 0 ? null : value.trim();
}
