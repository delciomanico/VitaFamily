// Conversão de uma data local (sem hora) para o instante UTC da meia-noite local, num fuso IANA
// (`exam.24h`, `domain/rule.ts`). Duplica, de propósito, a técnica de ponto fixo sobre
// `Intl.DateTimeFormat` já usada em `medications/domain/schedule.ts` (módulos só se importam pela
// raiz, conventions.md §1 — mesma justificação de `access/domain/age.ts`); versão mínima (sem
// `GAP`/`AMBIGUOUS`, dispensável para uma meia-noite: não há transição de DST na generalidade dos
// fusos às 00:00) — sem bibliotecas de fuso externas, só o ICU do Node (ADR-014).
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", minute: "2-digit" });
    offsetFormatters.set(timeZone, formatter);
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

/** `dateIso` = "YYYY-MM-DD" (`examinations.examDate`, entities.md). Devolve o instante UTC de
 * 00:00 local em `timeZone` nesse dia. */
export function localMidnightUtc(dateIso: string, timeZone: string): Date {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Ponto fixo: o desvio no instante candidato já é (quase sempre) o desvio correto à meia-noite.
  const offset = offsetMinutesAt(timeZone, new Date(naive));
  return new Date(naive - offset * 60_000);
}
