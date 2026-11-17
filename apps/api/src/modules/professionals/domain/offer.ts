// Ofertas e preços em Kz (BR-MKT-03/24/31). Validação pura; `specialtyId`, `method` e `durationMinutes` são imutáveis.
import { charLength } from "./text.js";
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";

export const OFFER_METHODS = ["IN_PERSON", "VIDEO", "CHAT", "PHONE"] as const;
export type OfferMethod = (typeof OFFER_METHODS)[number];
export const OFFER_DURATIONS_MINUTES = [15, 20, 30, 45, 60] as const;
export const MAX_ACTIVE_OFFERS = 20;
export const MAX_PRICE_KZ = 100_000_000;
export const MAX_OFFER_NOTE = 200;

export interface OfferFields {
  specialtyId: string;
  method: OfferMethod;
  durationMinutes: number;
  priceKz: number;
  note: string | null;
}

export interface OfferPatchFields {
  priceKz?: number;
  note?: string | null;
  active?: boolean;
}

function fail(fields: FieldError[]): never {
  throw new ValidationError(fields, { detail: "Oferta inválida." });
}

function validatePrice(value: unknown): number {
  // Kwanza inteiro, sem cêntimos (BR-MKT-31); decimais, texto e NaN são rejeitados.
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_PRICE_KZ) {
    fail([{ field: "priceKz", message: `inteiro entre 0 e ${String(MAX_PRICE_KZ)} (Kz)` }]);
  }
  return value;
}

function validateNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || charLength(value.trim()) > MAX_OFFER_NOTE) {
    fail([{ field: "note", message: `máximo ${String(MAX_OFFER_NOTE)} caracteres` }]);
  }
  return value.trim().length === 0 ? null : value.trim();
}

export function validateOfferInput(input: Record<string, unknown>): OfferFields {
  const { specialtyId, method, durationMinutes } = input;
  if (typeof specialtyId !== "string" || specialtyId.length === 0) fail([{ field: "specialtyId", message: "obrigatório" }]);
  if (typeof method !== "string" || !(OFFER_METHODS as readonly string[]).includes(method)) fail([{ field: "method", message: "método inválido" }]);
  if (typeof durationMinutes !== "number" || !(OFFER_DURATIONS_MINUTES as readonly number[]).includes(durationMinutes)) {
    fail([{ field: "durationMinutes", message: "15, 20, 30, 45 ou 60" }]);
  }
  return { specialtyId, method: method as OfferMethod, durationMinutes, priceKz: validatePrice(input.priceKz), note: validateNote(input.note) };
}

/** `specialtyId`/`method`/`durationMinutes` não se alteram (criar outra oferta ⇒ `VALIDATION_ERROR`). */
export function validateOfferPatch(input: Record<string, unknown>): OfferPatchFields {
  const immutable = ["specialtyId", "method", "durationMinutes"].filter((k) => k in input);
  if (immutable.length > 0) fail(immutable.map((field) => ({ field, message: "imutável: criar outra oferta" })));
  const patch: OfferPatchFields = {};
  if ("priceKz" in input) patch.priceKz = validatePrice(input.priceKz);
  if ("note" in input) patch.note = validateNote(input.note);
  if ("active" in input) {
    if (typeof input.active !== "boolean") fail([{ field: "active", message: "booleano" }]);
    patch.active = input.active;
  }
  if (Object.keys(patch).length === 0) fail([{ field: "body", message: "nenhum campo para alterar" }]);
  return patch;
}
