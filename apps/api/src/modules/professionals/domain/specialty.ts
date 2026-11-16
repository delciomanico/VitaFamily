// Catálogo de especialidades (BR-MKT-02/22, UC-MKT-07): validação pura, sem I/O. `category` é dado do catálogo, nunca um `if` por especialidade.
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";

export const SPECIALTY_CATEGORIES = ["HEALTH", "WELLNESS"] as const;
export type SpecialtyCategory = (typeof SPECIALTY_CATEGORIES)[number];
export const MIN_SPECIALTY_NAME_LENGTH = 2;
export const MAX_SPECIALTY_NAME_LENGTH = 80;

export interface SpecialtyInputFields {
  name: string;
  category: SpecialtyCategory;
}

export interface SpecialtyPatchFields {
  name?: string;
  category?: SpecialtyCategory;
  active?: boolean;
}

function fail(fields: FieldError[]): never {
  throw new ValidationError(fields, { detail: "Especialidade inválida." });
}

/** Nome aparado; tamanho em pontos de código (como `char_length` na BD). */
function validateName(value: unknown): string {
  if (typeof value !== "string") {
    fail([{ field: "name", message: "nome inválido" }]);
  }
  const name = value.trim();
  const length = Array.from(name).length;
  if (length < MIN_SPECIALTY_NAME_LENGTH || length > MAX_SPECIALTY_NAME_LENGTH) {
    fail([{ field: "name", message: "o nome tem de ter entre 2 e 80 caracteres" }]);
  }
  return name;
}

function validateCategory(value: unknown): SpecialtyCategory {
  if (typeof value !== "string" || !(SPECIALTY_CATEGORIES as readonly string[]).includes(value)) {
    fail([{ field: "category", message: "categoria inválida" }]);
  }
  return value as SpecialtyCategory;
}

/** Valida a criação (`SpecialtyInput`): nome aparado 2–80 e categoria `HEALTH`|`WELLNESS`. */
export function validateSpecialtyInput(input: { name: unknown; category: unknown }): SpecialtyInputFields {
  return { name: validateName(input.name), category: validateCategory(input.category) };
}

/** Valida a alteração (`SpecialtyPatch`): pelo menos um campo; só `name`, `category` e `active`. */
export function validateSpecialtyPatch(patch: { name?: unknown; category?: unknown; active?: unknown }): SpecialtyPatchFields {
  const present = [patch.name, patch.category, patch.active].filter((value) => value !== undefined).length;
  if (present === 0) {
    fail([{ field: "body", message: "indique pelo menos um campo a alterar" }]);
  }
  const result: SpecialtyPatchFields = {};
  if (patch.name !== undefined) result.name = validateName(patch.name);
  if (patch.category !== undefined) result.category = validateCategory(patch.category);
  if (patch.active !== undefined) {
    if (typeof patch.active !== "boolean") fail([{ field: "active", message: "active tem de ser booleano" }]);
    result.active = patch.active;
  }
  return result;
}
