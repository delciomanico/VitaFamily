// Geração de instantes UTC a partir de horas locais do fuso IANA efetivo do sujeito (ADR-010; Q8;
// `architecture.md`: "Cálculo em UTC a partir da hora local do fuso efetivo (DST: hora inexistente
// -> próxima válida; hora repetida -> primeira ocorrência)"). Puro, sem I/O: usa só
// `Intl.DateTimeFormat` (global da plataforma, não biblioteca de I/O — mesmo critério de
// `assertValidTimezone` em `users/domain/user.ts`); nenhuma dependência de fusos horários externa
// (ADR-014 evita dependências desnecessárias; o motor ICU do Node já resolve regras IANA/DST).

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      hour: "2-digit",
      minute: "2-digit",
    });
    offsetFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function partsFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Desvio (minutos a leste de UTC) de `timeZone` no instante `instant`. */
function offsetMinutesAt(timeZone: string, instant: Date): number {
  const parts = offsetFormatter(timeZone).formatToParts(instant);
  const tzName = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(tzName);
  if (!match?.[1] || !match[2] || !match[3]) {
    return 0;
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Hora local (ano/mês/dia/hora/minuto) de `timeZone` no instante `instant`. */
export function localDateTimeOf(instant: Date, timeZone: string): LocalDateTime {
  const parts = partsFormatterFor(timeZone).formatToParts(instant);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) {
      throw new Error(`Intl.DateTimeFormat não devolveu a parte "${type}" (fuso "${timeZone}").`);
    }
    return Number(part.value);
  };
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function sameLocal(a: LocalDateTime, b: LocalDateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

/** Soma `days` dias (pode ser negativo) a uma data local — aritmética de calendário pura (usa
 * `Date.UTC` só como calculadora de overflow de mês/ano, não representa um instante real). */
export function addCalendarDays(date: LocalDate, days: number): LocalDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/** Dia da semana ISO (1=segunda .. 7=domingo) de uma data local — `schema.md`/`days_of_week`. */
export function isoWeekday(date: LocalDate): number {
  const jsDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(); // 0=domingo
  return jsDay === 0 ? 7 : jsDay;
}

/** Janela de sondagem dos dois lados do instante "ingénuo" para encontrar as hipóteses de desvio em
 * jogo numa transição de DST (nunca observado >2h no mundo real; 3h dá margem confortável). */
const DST_PROBE_WINDOW_MS = 3 * 60 * 60 * 1000;

export type ZonedConversionKind = "UNAMBIGUOUS" | "GAP" | "AMBIGUOUS";

export interface ZonedConversionResult {
  utc: Date;
  /** `UNAMBIGUOUS`: hora normal. `GAP`: hora inexistente (ex.: 01:30 no último domingo de março em
   * Europe/Lisbon) — `utc` já corresponde ao avanço automático para a hora válida seguinte.
   * `AMBIGUOUS`: hora repetida (último domingo de outubro) — `utc` é a **primeira** ocorrência
   * (instante mais cedo), conforme `architecture.md`. */
  kind: ZonedConversionKind;
}

/**
 * Converte uma hora local "ingénua" (sem fuso) para o instante UTC equivalente em `timeZone`, pelo
 * algoritmo de ponto fixo sobre `Intl.DateTimeFormat` (sem bibliotecas de fuso externas — o ICU do
 * Node já resolve as regras IANA, incluindo DST).
 */
export function zonedTimeToUtc(local: LocalDateTime, timeZone: string): ZonedConversionResult {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);

  const offsetA = offsetMinutesAt(timeZone, new Date(naive));
  const candidateA = naive - offsetA * 60_000;
  const offsetB = offsetMinutesAt(timeZone, new Date(candidateA));
  const candidateB = naive - offsetB * 60_000;

  const probeBefore = offsetMinutesAt(timeZone, new Date(naive - DST_PROBE_WINDOW_MS));
  const probeAfter = offsetMinutesAt(timeZone, new Date(naive + DST_PROBE_WINDOW_MS));

  const candidateOffsets = [...new Set([offsetA, offsetB, probeBefore, probeAfter])];
  const validInstants: number[] = [];
  for (const offset of candidateOffsets) {
    const candidate = naive - offset * 60_000;
    if (sameLocal(localDateTimeOf(new Date(candidate), timeZone), local)) {
      validInstants.push(candidate);
    }
  }
  validInstants.sort((a, b) => a - b);

  const first = validInstants[0];
  if (first === undefined) {
    // GAP: nenhum desvio reproduz a hora pedida — `candidateB` é, por construção do ponto fixo, o
    // instante UTC que cai na hora local válida imediatamente após o "salto" (ex.: pedir 01:30
    // quando o relógio avança de 01:00 para 02:00 devolve 02:30).
    return { utc: new Date(candidateB), kind: "GAP" };
  }
  if (validInstants.length === 1) {
    return { utc: new Date(first), kind: "UNAMBIGUOUS" };
  }
  return { utc: new Date(first), kind: "AMBIGUOUS" };
}

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_PATTERN.test(value);
}

/** Lança `Error` genérico (puro) se inválido — quem chama (`medication-plan.ts`) já validou o
 * formato antes com `isValidTimeOfDay` e traduz para `INVALID_SCHEDULE`. */
export function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = TIME_OF_DAY_PATTERN.exec(value);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Hora inválida: "${value}" (esperado HH:mm).`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export interface ScheduleWindow {
  /** Início da janela, inclusive. */
  from: Date;
  /** Fim da janela, inclusive. */
  to: Date;
}

export interface FixedTimesSchedule {
  scheduleType: "FIXED_TIMES";
  times: string[]; // "HH:mm", locais no fuso efetivo
  daysOfWeek: number[]; // 1-7 (ISO); vazio = todos os dias (BR-MED-01)
}

export interface IntervalSchedule {
  scheduleType: "INTERVAL";
  intervalHours: number;
  /** Âncora absoluta (UTC) do plano — início de vigência, não hora local (AC-MED-01: "intervalos
   * absolutos", sem efeito de fuso/DST). */
  startAt: Date;
}

export type Schedule = FixedTimesSchedule | IntervalSchedule;

const MAX_FIXED_TIMES_DAYS = 40; // margem generosa acima da janela máxima real (14 dias, DM5).

/**
 * Gera os instantes (UTC, ordenados) de um plano dentro de `window`, limitados pela vigência do
 * plano (`planStart`/`planEnd`, nunca gera fora dela). `FIXED_TIMES` usa `timeZone` (DST-aware,
 * `zonedTimeToUtc`); `INTERVAL` é aritmética absoluta a partir de `startAt` (sem fuso).
 */
export function generateOccurrences(
  schedule: Schedule,
  window: ScheduleWindow,
  planStart: Date,
  planEnd: Date | null,
  timeZone: string,
): Date[] {
  const from = new Date(Math.max(window.from.getTime(), planStart.getTime()));
  const to = planEnd ? new Date(Math.min(window.to.getTime(), planEnd.getTime())) : window.to;
  if (from.getTime() > to.getTime()) {
    return [];
  }
  return schedule.scheduleType === "INTERVAL"
    ? generateIntervalOccurrences(schedule, from, to)
    : generateFixedTimesOccurrences(schedule, from, to, timeZone);
}

function generateIntervalOccurrences(schedule: IntervalSchedule, from: Date, to: Date): Date[] {
  const stepMs = schedule.intervalHours * 60 * 60 * 1000;
  const anchor = schedule.startAt.getTime();
  const occurrences: Date[] = [];
  let current = anchor;
  if (current < from.getTime()) {
    const steps = Math.ceil((from.getTime() - current) / stepMs);
    current += steps * stepMs;
  }
  for (; current <= to.getTime(); current += stepMs) {
    if (current >= from.getTime()) {
      occurrences.push(new Date(current));
    }
  }
  return occurrences;
}

function generateFixedTimesOccurrences(schedule: FixedTimesSchedule, from: Date, to: Date, timeZone: string): Date[] {
  const occurrences: Date[] = [];
  const sortedTimes = [...schedule.times].sort();
  let day: LocalDate = localDateTimeOf(from, timeZone);

  for (let i = 0; i < MAX_FIXED_TIMES_DAYS; i++) {
    const dayStart = zonedTimeToUtc({ ...day, hour: 0, minute: 0 }, timeZone).utc;
    if (dayStart.getTime() > to.getTime()) {
      break;
    }
    if (schedule.daysOfWeek.length === 0 || schedule.daysOfWeek.includes(isoWeekday(day))) {
      for (const time of sortedTimes) {
        const { hour, minute } = parseTimeOfDay(time);
        const { utc } = zonedTimeToUtc({ ...day, hour, minute }, timeZone);
        if (utc.getTime() >= from.getTime() && utc.getTime() <= to.getTime()) {
          occurrences.push(utc);
        }
      }
    }
    day = addCalendarDays(day, 1);
  }

  occurrences.sort((a, b) => a.getTime() - b.getTime());
  return occurrences;
}
