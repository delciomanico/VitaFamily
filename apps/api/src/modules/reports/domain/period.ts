// Período do relatório individual (Q11/BR-RPT-02): por defeito os últimos 12 meses; máximo 5 anos.
import { ValidationError } from "../../../platform/errors/index.js";

export const REPORT_DEFAULT_MONTHS = 12;
export const REPORT_MAX_YEARS = 5;

export interface ReportPeriod {
  /** yyyy-mm-dd, inclusive. */
  from: string;
  /** yyyy-mm-dd, inclusive. */
  to: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string, field: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (!DATE_PATTERN.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError([{ field, message: "data inválida (yyyy-mm-dd)" }], { detail: "Período inválido." });
  }
  return date;
}

function monthsBefore(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** `today` vem do `Clock` (yyyy-mm-dd). */
export function resolvePeriod(from: string | undefined, to: string | undefined, today: string): ReportPeriod {
  const toDate = to !== undefined ? parseDate(to, "to") : parseDate(today, "to");
  const fromDate = from !== undefined ? parseDate(from, "from") : monthsBefore(toDate, REPORT_DEFAULT_MONTHS);
  if (fromDate > toDate || fromDate < monthsBefore(toDate, REPORT_MAX_YEARS * 12)) {
    throw new ValidationError([{ field: "from", message: "intervalo máximo de 5 anos" }], { detail: "Período inválido." });
  }
  return { from: iso(fromDate), to: iso(toDate) };
}
