// Perfil do profissional (BR-MKT-23/26): validação pura do patch. `displayName` é identidade (só DRAFT/NEEDS_INFO); `bio`, `city` e
// `paymentInstructions` são campos livres. `paymentInstructions` é texto livre, nunca exposto fora do próprio (BR-MKT-26).
import { charLength } from "./text.js";
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";

export const MAX_SPECIALTIES_PER_PROFESSIONAL = 5;

export interface ProfilePatch {
  displayName?: string;
  bio?: string | null;
  city?: string;
  paymentInstructions?: string | null;
}

export type ProfilePatchField = keyof ProfilePatch;
/** Campos de identidade: só em DRAFT/NEEDS_INFO (BR-MKT-23, OP-62). */
export const IDENTITY_FIELDS: readonly ProfilePatchField[] = ["displayName"];

function fail(fields: FieldError[]): never {
  throw new ValidationError(fields, { detail: "Perfil inválido." });
}

function required(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") fail([{ field, message: "texto obrigatório" }]);
  const trimmed = value.trim();
  const len = charLength(trimmed);
  if (len < min || len > max) fail([{ field, message: `entre ${String(min)} e ${String(max)} caracteres` }]);
  return trimmed;
}

function optional(value: unknown, field: string, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail([{ field, message: "texto ou nulo" }]);
  const trimmed = value.trim();
  if (charLength(trimmed) > max) fail([{ field, message: `no máximo ${String(max)} caracteres` }]);
  return trimmed.length === 0 ? null : trimmed;
}

/** Só as chaves conhecidas e presentes; corpo vazio ⇒ `VALIDATION_ERROR`. */
export function validateProfilePatch(input: Record<string, unknown>): ProfilePatch {
  const patch: ProfilePatch = {};
  if ("displayName" in input) patch.displayName = required(input.displayName, "displayName", 2, 120);
  if ("city" in input) patch.city = required(input.city, "city", 2, 80);
  if ("bio" in input) patch.bio = optional(input.bio, "bio", 1000);
  if ("paymentInstructions" in input) patch.paymentInstructions = optional(input.paymentInstructions, "paymentInstructions", 500);
  if (Object.keys(patch).length === 0) fail([{ field: "body", message: "nenhum campo para alterar" }]);
  return patch;
}

/** 1–5 ids distintos. */
export function validateSpecialtyIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_SPECIALTIES_PER_PROFESSIONAL || input.some((id) => typeof id !== "string" || id.length === 0)) {
    fail([{ field: "specialtyIds", message: `entre 1 e ${String(MAX_SPECIALTIES_PER_PROFESSIONAL)} identificadores` }]);
  }
  const ids = input as string[];
  if (new Set(ids).size !== ids.length) fail([{ field: "specialtyIds", message: "identificadores repetidos" }]);
  return ids;
}
