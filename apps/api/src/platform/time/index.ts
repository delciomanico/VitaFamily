// Aritmética de dias civis no fuso da clínica (M14 Q: fluxo do dia, retorno, indicadores). Utilitário técnico, sem
// regras de negócio: o fuso é fixo porque a Vita Family só opera em Portugal (mesmo valor de `clinics`
// `CLINIC_TIMEZONE`). Só o ICU do Node (`Intl`), sem bibliotecas de fuso. Datas locais = "AAAA-MM-DD".

export const CLINIC_TIMEZONE = "Europe/Lisbon";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", minute: "2-digit" });
    offsetFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function offsetMinutesAt(timeZone: string, instant: Date): number {
  const name = offsetFormatter(timeZone).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!match?.[1] || !match[2] || !match[3]) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

/** `true` se `value` é um dia civil real "AAAA-MM-DD". */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function parts(dateIso: string): [number, number, number] {
  const match = DATE_PATTERN.exec(dateIso);
  if (!match?.[1] || !match[2] || !match[3]) throw new Error(`Data inválida: ${dateIso}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Dia civil local de um instante. */
export function localDateIso(instant: Date, timeZone: string = CLINIC_TIMEZONE): string {
  return dayFormatter(timeZone).format(instant);
}

/** Instante UTC da meia-noite local de `dateIso` (a meia-noite nunca cai num salto de DST em Europe/Lisbon). */
export function localMidnightUtc(dateIso: string, timeZone: string = CLINIC_TIMEZONE): Date {
  const [year, month, day] = parts(dateIso);
  const naive = Date.UTC(year, month - 1, day);
  const first = naive - offsetMinutesAt(timeZone, new Date(naive)) * 60_000;
  return new Date(naive - offsetMinutesAt(timeZone, new Date(first)) * 60_000);
}

/** Soma `days` dias civis. */
export function addDaysIso(dateIso: string, days: number): string {
  const [year, month, day] = parts(dateIso);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return format(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Soma `months` meses civis; o dia é limitado ao último do mês de destino (31 jan + 1 mês = 28/29 fev). */
export function addMonthsIso(dateIso: string, months: number): string {
  const [year, month, day] = parts(dateIso);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return format(targetYear, targetMonth, Math.min(day, lastDay));
}

/** Número de dias civis entre duas datas (`to - from`). */
export function diffDaysIso(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = parts(fromIso);
  const [ty, tm, td] = parts(toIso);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Janela `[início, fim)` do dia civil local que contém `instant`. */
export function localDayWindow(instant: Date, timeZone: string = CLINIC_TIMEZONE): { start: Date; end: Date; dateIso: string } {
  const dateIso = localDateIso(instant, timeZone);
  return { start: localMidnightUtc(dateIso, timeZone), end: localMidnightUtc(addDaysIso(dateIso, 1), timeZone), dateIso };
}
