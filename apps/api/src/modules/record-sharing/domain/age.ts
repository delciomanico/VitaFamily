// Datas civis em `Africa/Luanda` (UTC+1 fixo, sem DST) e idade em anos completos (OP-119, BR-MKT-68). Puro: só aritmética sobre milissegundos
// desde a época (o domínio não constrói `Date`). A idade deriva-se da data de nascimento **na leitura**; nunca se guarda.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** `Africa/Luanda` = UTC+1 o ano todo. */
export const LUANDA_OFFSET_MS = HOUR_MS;

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** Algoritmo `civil_from_days` (dias desde 1970-01-01 → data do calendário gregoriano proléptico). */
function civilFromDays(days: number): CivilDate {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** Dia do calendário em Luanda do instante `ms`. */
export function luandaCivilDate(ms: number): CivilDate {
  return civilFromDays(Math.floor((ms + LUANDA_OFFSET_MS) / DAY_MS));
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");
export function formatCivilDate(d: CivilDate): string {
  return `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}`;
}

/** `AAAA-MM-DD` do dia em Luanda (marca de água `openedOn`). */
export function luandaDay(ms: number): string {
  return formatCivilDate(luandaCivilDate(ms));
}

export function parseCivilDate(text: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * Anos completos à data de `nowMs` em Luanda. Nascido em 29 de fevereiro faz anos a 1 de março nos anos não bissextos.
 * `null` se a data de nascimento for inválida; nunca negativa (data futura ⇒ 0).
 */
export function computeAgeYears(birthDate: string, nowMs: number): number | null {
  const birth = parseCivilDate(birthDate);
  if (!birth) return null;
  const today = luandaCivilDate(nowMs);
  let years = today.year - birth.year;
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) years -= 1;
  return Math.max(0, years);
}

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

/** `AAAA-MM-DD` do dia em Luanda de há `months` meses (dia ajustado ao fim do mês se não existir). Janela de 24 meses de BR-MKT-68. */
export function luandaDayMonthsAgo(nowMs: number, months: number): string {
  const t = luandaCivilDate(nowMs);
  const total = t.year * 12 + (t.month - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12 + 12) % 12 + 1;
  return formatCivilDate({ year, month, day: Math.min(t.day, daysIn(year, month)) });
}
