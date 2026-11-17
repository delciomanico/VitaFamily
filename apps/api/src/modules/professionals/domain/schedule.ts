// Regras de horário semanais, geração idempotente de horários, bloqueios e planeamento (BR-MKT-25, BR-MKT-31). Funções puras.
// Fuso fixo `Africa/Luanda` (UTC+1, sem horário de verão): por isso a conversão local→UTC é uma subtração constante, sem os casos
// de GAP/AMBIGUOUS do motor das clínicas (`Europe/Lisbon`). OP-72 (resolvida por omissão segura, OP-74): o motor das clínicas NÃO é
// tocado nem importado; reutilizam-se só os utilitários de calendário de `platform/time`.
import { charLength } from "./text.js";
import { ValidationError } from "../../../platform/errors/index.js";
import { addDaysIso, isIsoDate, localDateIso } from "../../../platform/time/index.js";

export const PROFESSIONAL_TIMEZONE = "Africa/Luanda";
const LUANDA_OFFSET_MINUTES = 60;
export const MAX_SCHEDULE_RULES = 20;
export const MAX_TIME_OFF_DAYS = 366;
/** BR-MKT-25: janela rolante de 8 semanas (hoje inclusive, + 56 dias). */
export const SCHEDULE_HORIZON_WEEKS = 8;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ScheduleRuleFields {
  weekdays: number[];
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validUntil: string | null;
}

export interface CandidateSlot {
  startsAt: Date;
  endsAt: Date;
}

export interface ExistingSlot extends CandidateSlot {
  ruleId: string;
}

export interface GenerationCounts {
  created: number;
  unchanged: number;
  removed: number;
  skippedOverlap: number;
  skippedTimeOff: number;
}

export function emptyGeneration(): GenerationCounts {
  return { created: 0, unchanged: 0, removed: 0, skippedOverlap: 0, skippedTimeOff: 0 };
}

export function addGeneration(a: GenerationCounts, b: GenerationCounts): GenerationCounts {
  return {
    created: a.created + b.created,
    unchanged: a.unchanged + b.unchanged,
    removed: a.removed + b.removed,
    skippedOverlap: a.skippedOverlap + b.skippedOverlap,
    skippedTimeOff: a.skippedTimeOff + b.skippedTimeOff,
  };
}

function minutesOf(time: string): number {
  const match = TIME_PATTERN.exec(time);
  if (!match?.[1] || !match[2]) throw new Error(`Hora inválida: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Dia civil de Luanda de um instante (BR-MKT-31). */
export function luandaToday(now: Date): string {
  return localDateIso(now, PROFESSIONAL_TIMEZONE);
}

/** Instante UTC de `dia` + `HH:mm` locais de Luanda. */
export function luandaToUtc(dateIso: string, time: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 0, minutesOf(time) - LUANDA_OFFSET_MINUTES));
}

/** Dia da semana ISO (1 = segunda ... 7 = domingo) de um dia civil. */
export function isoWeekday(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

function bad(field: string, message: string, detail: string): never {
  throw new ValidationError([{ field, message }], { detail });
}

function validDay(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isIsoDate(value)) bad(field, "esperado AAAA-MM-DD (dia existente)", "Data inválida.");
  return value;
}

/** BR-MKT-25: valida os campos de uma regra contra a duração da oferta. */
export function validateRuleFields(input: Record<string, unknown>, durationMinutes: number): ScheduleRuleFields {
  const { weekdays, startTime, endTime } = input;
  if (
    !Array.isArray(weekdays) ||
    weekdays.length < 1 ||
    weekdays.length > 7 ||
    weekdays.some((d) => !Number.isInteger(d) || (d as number) < 1 || (d as number) > 7) ||
    new Set(weekdays).size !== weekdays.length
  ) {
    bad("weekdays", "1 a 7 dias distintos (1 = segunda ... 7 = domingo)", "Dias da semana inválidos.");
  }
  if (typeof startTime !== "string" || !TIME_PATTERN.test(startTime)) bad("startTime", "esperado HH:mm", "Hora inválida.");
  if (typeof endTime !== "string" || !TIME_PATTERN.test(endTime)) bad("endTime", "esperado HH:mm", "Hora inválida.");
  const start = minutesOf(startTime);
  const end = minutesOf(endTime);
  if (end <= start) bad("endTime", "tem de ser posterior a startTime", "Intervalo horário inválido.");
  if (end - start < durationMinutes) bad("endTime", "o intervalo tem de caber pelo menos uma duração da oferta", "Intervalo menor que a duração da oferta.");
  const validFrom = validDay(input.validFrom, "validFrom");
  const validUntil = validDay(input.validUntil, "validUntil");
  if (validFrom && validUntil && validUntil < validFrom) bad("validUntil", "não pode ser anterior a validFrom", "Validade inválida.");
  return { weekdays: [...(weekdays as number[])].sort((a, b) => a - b), startTime, endTime, validFrom, validUntil };
}

/** BR-MKT-25: regras do mesmo profissional sobrepõem-se se partilham dia da semana, horas e validade (`null` = aberto). */
export function rulesOverlap(a: ScheduleRuleFields, b: ScheduleRuleFields): boolean {
  if (!a.weekdays.some((day) => b.weekdays.includes(day))) return false;
  if (!(minutesOf(a.startTime) < minutesOf(b.endTime) && minutesOf(b.startTime) < minutesOf(a.endTime))) return false;
  const aBeforeB = a.validUntil !== null && b.validFrom !== null && a.validUntil < b.validFrom;
  const bBeforeA = b.validUntil !== null && a.validFrom !== null && b.validUntil < a.validFrom;
  return !aBeforeB && !bBeforeA;
}

export interface GenerationWindow {
  firstDay: string;
  lastDay: string;
}

export function generationWindow(now: Date, horizonWeeks: number = SCHEDULE_HORIZON_WEEKS): GenerationWindow {
  const firstDay = luandaToday(now);
  return { firstDay, lastDay: addDaysIso(firstDay, horizonWeeks * 7) };
}

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Horários consecutivos de `durationMinutes` desde `startTime` enquanto terminem em/antes de `endTime`, nos dias da regra dentro da
 * janela e da validade; ignora o passado (`startsAt <= now`). Não considera bloqueios nem horários existentes (`planGeneration`).
 */
export function generateRuleCandidates(rule: ScheduleRuleFields, durationMinutes: number, window: GenerationWindow, now: Date): CandidateSlot[] {
  const durationMs = durationMinutes * 60_000;
  const out: CandidateSlot[] = [];
  for (let day = window.firstDay; day <= window.lastDay; day = addDaysIso(day, 1)) {
    if (!rule.weekdays.includes(isoWeekday(day))) continue;
    if (rule.validFrom && day < rule.validFrom) continue;
    if (rule.validUntil && day > rule.validUntil) continue;
    const endMs = luandaToUtc(day, rule.endTime).getTime();
    for (let cursor = luandaToUtc(day, rule.startTime).getTime(); cursor + durationMs <= endMs; cursor += durationMs) {
      if (cursor > now.getTime()) out.push({ startsAt: new Date(cursor), endsAt: new Date(cursor + durationMs) });
    }
  }
  return out;
}

export interface GenerationPlan {
  toCreate: CandidateSlot[];
  unchanged: number;
  skippedOverlap: number;
  skippedTimeOff: number;
}

/**
 * Planeamento idempotente: candidato já existente da própria regra ⇒ `unchanged`; cai num bloqueio ⇒ `skippedTimeOff`; sobrepõe outro
 * horário do profissional ⇒ `skippedOverlap`; senão cria-se (e passa a ocupar). `existing` = horários do profissional de qualquer regra.
 */
export function planGeneration(ruleId: string, candidates: CandidateSlot[], existing: ExistingSlot[], timeOffs: { startsAt: Date; endsAt: Date }[]): GenerationPlan {
  const occupied = existing.map((s) => ({ start: s.startsAt, end: s.endsAt, ruleId: s.ruleId }));
  const plan: GenerationPlan = { toCreate: [], unchanged: 0, skippedOverlap: 0, skippedTimeOff: 0 };
  for (const c of candidates) {
    if (occupied.some((o) => o.ruleId === ruleId && o.start.getTime() === c.startsAt.getTime())) {
      plan.unchanged += 1;
    } else if (timeOffs.some((t) => intervalsOverlap(c.startsAt, c.endsAt, t.startsAt, t.endsAt))) {
      plan.skippedTimeOff += 1;
    } else if (occupied.some((o) => intervalsOverlap(c.startsAt, c.endsAt, o.start, o.end))) {
      plan.skippedOverlap += 1;
    } else {
      plan.toCreate.push(c);
      occupied.push({ start: c.startsAt, end: c.endsAt, ruleId });
    }
  }
  return plan;
}

/** Horários futuros da regra que já não correspondem ao que ela prevê (a remover ao alterar/desativar). */
export function staleRuleSlots<T extends { startsAt: Date }>(futureRuleSlots: T[], desired: CandidateSlot[]): T[] {
  const desiredStarts = new Set(desired.map((c) => c.startsAt.getTime()));
  return futureRuleSlots.filter((s) => !desiredStarts.has(s.startsAt.getTime()));
}

/** Bloqueio: `endsAt > startsAt`, ≤ 366 dias, `endsAt` no futuro (BR-MKT-25; UC-MKT-09). */
export function assertValidTimeOffRange(startsAt: Date, endsAt: Date, now: Date): void {
  const err = (field: string, message: string): never => bad(field, message, "Intervalo de bloqueio inválido.");
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) err("startsAt", "data/hora inválida");
  if (endsAt.getTime() <= startsAt.getTime()) err("endsAt", "tem de ser posterior a startsAt");
  if (endsAt.getTime() - startsAt.getTime() > MAX_TIME_OFF_DAYS * 86_400_000) err("endsAt", `no máximo ${String(MAX_TIME_OFF_DAYS)} dias`);
  if (endsAt.getTime() <= now.getTime()) err("endsAt", "tem de estar no futuro");
}

export function normalizeTimeOffReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || charLength(value.trim()) > 200) bad("reason", "máximo 200 caracteres", "Motivo inválido.");
  return value.trim().length === 0 ? null : value.trim();
}
