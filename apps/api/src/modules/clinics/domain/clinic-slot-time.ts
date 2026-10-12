// Conversão de data+hora local para o instante UTC equivalente, ao publicar `ClinicSlot`
// (`ClinicSlotBatchInput`, BR-CLN-04/UC-CLN-04). A Vita Family só opera em Portugal (CLAUDE.md),
// por isso o fuso é fixo (`CLINIC_TIMEZONE`), sem precisar do fuso efetivo do titular (esse
// conceito é de `families`/`medications`, que `clinics` não importa, conventions.md §3.3).
// Mesmo algoritmo de ponto fixo sobre `Intl.DateTimeFormat` de `medications/domain/schedule.ts`
// (duplicado deliberadamente: módulos independentes, não há aresta `clinics` -> `medications` em
// `modules.md`; só o ICU do Node resolve as regras IANA/DST, sem bibliotecas de fuso externas).
import { ValidationError } from "../../../platform/errors/index.js";

export const CLINIC_TIMEZONE = "Europe/Lisbon";

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseLocalDate(value: string, field = "date"): LocalDate {
  const match = DATE_PATTERN.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new ValidationError([{ field, message: "esperado AAAA-MM-DD" }], { detail: "Data inválida." });
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function isValidLocalTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function parseLocalTime(value: string, field = "times"): { hour: number; minute: number } {
  const match = TIME_PATTERN.exec(value);
  if (!match?.[1] || !match[2]) {
    throw new ValidationError([{ field, message: "esperado HH:mm" }], { detail: "Hora inválida." });
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", minute: "2-digit" });
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

function localDateTimeOf(instant: Date, timeZone: string): LocalDateTime {
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

/** Janela de sondagem dos dois lados do instante "ingénuo" para encontrar os desvios em jogo numa
 * transição de DST (nunca observado >2h no mundo real; 3h dá margem confortável). */
const DST_PROBE_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Converte uma hora local "ingénua" para o instante UTC equivalente em `timeZone` (default
 * `CLINIC_TIMEZONE`), pelo algoritmo de ponto fixo sobre `Intl.DateTimeFormat`. Hora inexistente
 * (GAP, ex.: salto de março em Europe/Lisbon) avança para a hora válida seguinte; hora repetida
 * (AMBIGUOUS, salto de outubro) devolve a primeira ocorrência — mesmo critério de
 * `medications/domain/schedule.ts`/`architecture.md`.
 */
export function zonedTimeToUtc(local: LocalDateTime, timeZone: string = CLINIC_TIMEZONE): Date {
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
    // GAP: nenhum desvio reproduz a hora pedida — `candidateB` cai na hora local válida logo após o salto.
    return new Date(candidateB);
  }
  return new Date(first);
}
