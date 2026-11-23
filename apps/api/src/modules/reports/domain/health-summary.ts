// Cálculo PURO do Resumo de saúde (M17, BR-RPT-11..17): só aritmética determinística sobre factos já
// registados. Nunca interpreta nem assinala «fora da referência» (BR-EXM-02, BR-HLT-03); sem I/O.
import { addDaysIso, diffDaysIso, localDateIso } from "../../../platform/time/index.js";
import type { ReportPeriod } from "./period.js";

/** BR-RPT-15 / OP-143: constantes propostas. */
export const ENDING_SOON_DAYS = 14;
export const UPCOMING_DAYS = 30;
export const MAX_SERIES = 20;
export const MAX_POINTS = 100;
/** BR-RPT-12: série semanal até este nº de dias, mensal acima. */
export const WEEKLY_MAX_DAYS = 90;
export const MAX_SOURCE_IDS = 20;

export interface AdherenceCounts {
  taken: number;
  notTaken: number;
  unconfirmed: number;
}

export interface AdherenceBucket extends AdherenceCounts {
  periodStart: string;
  adherencePct: number | null;
}

/** BR-RPT-13: `round(100·taken/(taken+notTaken+unconfirmed))`; denominador 0 ⇒ `null` (nunca 0 %). */
export function adherencePct(counts: AdherenceCounts): number | null {
  const denominator = counts.taken + counts.notTaken + counts.unconfirmed;
  return denominator === 0 ? null : Math.round((100 * counts.taken) / denominator);
}

export interface DoseFact {
  scheduledAt: string;
  status: string;
}

const monthStart = (dateIso: string) => `${dateIso.slice(0, 7)}-01`;

/** Segunda-feira da semana civil que contém `dateIso`. */
export function weekStart(dateIso: string): string {
  const weekday = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return addDaysIso(dateIso, -((weekday + 6) % 7));
}

export function granularityFor(period: ReportPeriod): "WEEK" | "MONTH" {
  return diffDaysIso(period.from, period.to) + 1 <= WEEKLY_MAX_DAYS ? "WEEK" : "MONTH";
}

function bucketStarts(period: ReportPeriod, granularity: "WEEK" | "MONTH"): string[] {
  const starts: string[] = [];
  if (granularity === "WEEK") {
    for (let day = weekStart(period.from); day <= period.to; day = addDaysIso(day, 7)) starts.push(day);
    return starts;
  }
  const last = monthStart(period.to);
  for (let day = monthStart(period.from); day <= last; ) {
    starts.push(day);
    const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
    day = month === 12 ? `${String(year + 1).padStart(4, "0")}-01-01` : `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;
  }
  return starts;
}

/**
 * BR-RPT-13: série por semana/mês no fuso do utilizador. Só entram ocorrências `<= agora` e já com
 * estado final ou por confirmar (as `PENDING` ficam fora do cálculo).
 */
export function buildAdherenceSeries(doses: DoseFact[], period: ReportPeriod, now: Date, timeZone: string): { granularity: "WEEK" | "MONTH"; series: AdherenceBucket[] } {
  const granularity = granularityFor(period);
  const buckets = new Map<string, AdherenceCounts>(bucketStarts(period, granularity).map((start) => [start, { taken: 0, notTaken: 0, unconfirmed: 0 }]));
  for (const dose of doses) {
    const at = new Date(dose.scheduledAt);
    if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime()) continue;
    const local = localDateIso(at, timeZone);
    if (local < period.from || local > period.to) continue;
    const counts = buckets.get(granularity === "WEEK" ? weekStart(local) : monthStart(local));
    if (!counts) continue;
    if (dose.status === "TAKEN") counts.taken++;
    else if (dose.status === "NOT_TAKEN") counts.notTaken++;
    else if (dose.status === "UNCONFIRMED") counts.unconfirmed++;
  }
  return { granularity, series: [...buckets].map(([periodStart, counts]) => ({ periodStart, ...counts, adherencePct: adherencePct(counts) })) };
}

export const sumAdherence = (items: AdherenceCounts[]): AdherenceCounts =>
  items.reduce((sum, item) => ({ taken: sum.taken + item.taken, notTaken: sum.notTaken + item.notTaken, unconfirmed: sum.unconfirmed + item.unconfirmed }), { taken: 0, notTaken: 0, unconfirmed: 0 });

// --- Séries de parâmetros de exames (BR-RPT-14) ---

export interface ExamResultFact {
  parameter: string;
  valueNumeric: number | null;
  unit: string | null;
  referenceMin: number | null;
  referenceMax: number | null;
  createdAt: string;
}

export interface ExamFact {
  examDate: string;
  results: ExamResultFact[];
}

export interface ExamParameterSeries {
  parameter: string;
  unit: string;
  count: number;
  min: number;
  max: number;
  first: number;
  last: number;
  variationAbs: number | null;
  variationPct: number | null;
  referenceMin: number | null;
  referenceMax: number | null;
  points: { date: string; value: number }[];
  truncated: boolean;
}

/** Remove ruído de vírgula flutuante (0.1+0.2) sem arredondar de forma visível. */
const clean = (value: number): number => Math.round(value * 1e6) / 1e6;

interface Measurement {
  date: string;
  createdAt: string;
  value: number;
  parameter: string;
  unit: string;
  referenceMin: number | null;
  referenceMax: number | null;
}

/**
 * Agrupa por parâmetro (sem maiúsculas/espaços sobrantes) E unidade igual (nunca converte); só valores
 * numéricos finitos. Máx. 20 séries (as de medição mais recente) e 100 pontos por série.
 */
export function buildExamSeries(exams: ExamFact[]): { series: ExamParameterSeries[]; truncated: boolean } {
  const groups = new Map<string, Measurement[]>();
  for (const exam of exams) {
    for (const result of exam.results) {
      const value = result.valueNumeric;
      if (value === null || !Number.isFinite(value)) continue;
      const unit = (result.unit ?? "").trim();
      const key = `${result.parameter.trim().toLowerCase()}\u0000${unit}`;
      const list = groups.get(key) ?? [];
      list.push({ date: exam.examDate, createdAt: result.createdAt, value, parameter: result.parameter.trim(), unit, referenceMin: result.referenceMin, referenceMax: result.referenceMax });
      groups.set(key, list);
    }
  }

  const all = [...groups.values()].map((list): ExamParameterSeries => {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    const first = list[0];
    const last = list.at(-1);
    if (!first || !last) throw new Error("série sem medições");
    const values = list.map((m) => m.value);
    const points = list.map((m) => ({ date: m.date, value: m.value }));
    return {
      parameter: last.parameter,
      unit: last.unit,
      count: list.length,
      min: Math.min(...values),
      max: Math.max(...values),
      first: first.value,
      last: last.value,
      variationAbs: list.length < 2 ? null : clean(last.value - first.value),
      variationPct: list.length < 2 || first.value === 0 ? null : clean(((last.value - first.value) / Math.abs(first.value)) * 100),
      // Referência tal como o utilizador a indicou na última medição; só é mostrada, nunca comparada.
      referenceMin: last.referenceMin,
      referenceMax: last.referenceMax,
      points: points.slice(-MAX_POINTS),
      truncated: points.length > MAX_POINTS,
    };
  });
  const latest = (s: ExamParameterSeries) => s.points[s.points.length - 1]?.date ?? "";
  all.sort((a, b) => latest(b).localeCompare(latest(a)) || a.parameter.localeCompare(b.parameter) || a.unit.localeCompare(b.unit));
  return { series: all.slice(0, MAX_SERIES), truncated: all.length > MAX_SERIES };
}

// --- Contagens (BR-RPT-15) ---

export function countByStatus(items: { status: string }[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) result[item.status] = (result[item.status] ?? 0) + 1;
  return result;
}

/** `localDates` já em data local (yyyy-mm-dd); devolve `yyyy-mm` por ordem cronológica. */
export function countByMonth(localDates: string[]): { month: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const date of localDates) counts.set(date.slice(0, 7), (counts.get(date.slice(0, 7)) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
}

export const inRange = (date: string, from: string, to: string): boolean => date >= from && date <= to;

/** `true` se `date` está nos próximos `days` dias a partir de `today` (inclusive). */
export const withinNextDays = (date: string, today: string, days: number): boolean => date >= today && date <= addDaysIso(today, days);

export type MissingCode = "BLOOD_TYPE_UNSET" | "APPOINTMENT_PAST_OPEN" | "EXAM_PAST_OPEN" | "EXAM_WITHOUT_RESULTS" | "PRESCRIPTION_WITHOUT_DOCUMENT" | "PLAN_WITHOUT_SCHEDULE" | "DOSES_UNCONFIRMED";

export interface MissingRecordItem {
  code: MissingCode;
  count: number;
  sourceIds?: string[];
}

/**
 * BR-RPT-17: completude, não clínica. Itens com contagem 0 não aparecem; `sourceIds` só se `canWrite`.
 * Nunca se acrescentam códigos que sugiram consultas, exames ou tratamentos.
 */
export function missingItem(code: MissingCode, ids: string[], canWrite: boolean, count = ids.length): MissingRecordItem | null {
  if (count === 0) return null;
  return { code, count, ...(canWrite && ids.length > 0 ? { sourceIds: ids.slice(0, MAX_SOURCE_IDS) } : {}) };
}
