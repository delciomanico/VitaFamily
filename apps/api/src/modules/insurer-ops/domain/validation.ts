// Validações puras partilhadas (strings, datas, estados). Mensagens em pt-PT; nunca ecoam o valor recebido (dados pessoais).
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";

export function fail(field: string, message: string, detail = "Dados inválidos."): never {
  throw new ValidationError([{ field, message }], { detail });
}

export function requireText(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) fail(field, "não pode ser vazio");
  if (text.length > maxLength) fail(field, `no máximo ${String(maxLength)} caracteres`);
  return text;
}

/** Data de calendário `AAAA-MM-DD` real (rejeita 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function requireIsoDate(value: unknown, field: string): string {
  if (!isIsoDate(value)) fail(field, "data inválida (AAAA-MM-DD)");
  return value;
}

/** Nota obrigatória em SUSPENDED/CANCELLED (BR-SEG-24): persiste em `status_note`; nunca em auditoria nem logs (texto livre). */
export function requireNote(note: unknown, field = "note"): string {
  return requireText(note, field, 500);
}

export function validationFromFields(fields: FieldError[]): ValidationError {
  return new ValidationError(fields, { detail: "Dados inválidos." });
}

/** Nota a guardar com o novo estado: só SUSPENDED/CANCELLED a têm; qualquer outro estado limpa-a. */
export function statusNoteFor(status: string, note: unknown): string | null {
  return status === "SUSPENDED" || status === "CANCELLED" ? requireNote(note) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) fail(field, "identificador inválido");
  return value;
}

/** Soma `days` dias a uma data `AAAA-MM-DD` (UTC; sem fusos). */
export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) throw new Error("data inválida");
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
