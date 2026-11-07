// Catálogo da clínica (M14 a1, BR-CLN-11/12, schema.md §3a): profissionais e tipos de serviço.
// Regras puras (validações e limites), sem I/O. Não contém dados Vita nem de saúde.
import { ValidationError } from "../../../platform/errors/index.js";
import { assertValidDurationMinutes, assertValidSlotKind, type ClinicSlotKind } from "./clinic-slot.js";

export const MAX_CLINIC_PROFESSIONALS = 100;
export const MAX_CLINIC_SERVICE_TYPES = 100;
export const CLINIC_NAME_MAX = 120;
export const CLINIC_PROFESSIONAL_SPECIALTY_MAX = 80;
export const CLINIC_PRICE_MINOR_MAX = 100_000_000_000;

export interface ClinicProfessional {
  id: string;
  clinicId: string;
  name: string;
  specialty: string | null;
  active: boolean;
}

export interface ClinicServiceType {
  id: string;
  clinicId: string;
  name: string;
  /** Imutável (BR-CLN-12). */
  kind: ClinicSlotKind;
  durationMinutes: number;
  priceMinor: number | null;
  active: boolean;
}

/** Nome 1–120 sem espaços nas pontas (BR-CLN-11). */
export function assertValidCatalogName(value: unknown, field = "name"): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > CLINIC_NAME_MAX) {
    throw new ValidationError([{ field, message: `entre 1 e ${String(CLINIC_NAME_MAX)} caracteres` }], { detail: "Nome inválido." });
  }
  return name;
}

/** Especialidade opcional ≤ 80; vazia/`null` => `null`. */
export function normalizeProfessionalSpecialty(value: unknown, field = "specialty"): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError([{ field, message: "texto esperado" }], { detail: "Especialidade inválida." });
  }
  const specialty = value.trim();
  if (specialty.length > CLINIC_PROFESSIONAL_SPECIALTY_MAX) {
    throw new ValidationError([{ field, message: `máximo ${String(CLINIC_PROFESSIONAL_SPECIALTY_MAX)} caracteres` }], { detail: "Especialidade inválida." });
  }
  return specialty.length === 0 ? null : specialty;
}

/** BR-CLN-12: preço opcional, inteiro em cêntimos, 0 ≤ valor ≤ 10¹¹. */
export function normalizePriceMinor(value: unknown, field = "priceMinor"): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > CLINIC_PRICE_MINOR_MAX) {
    throw new ValidationError([{ field, message: `inteiro entre 0 e ${String(CLINIC_PRICE_MINOR_MAX)} (cêntimos)` }], { detail: "Preço inválido." });
  }
  return value;
}

export function assertValidServiceKind(value: unknown): ClinicSlotKind {
  if (value === undefined || value === null) {
    throw new ValidationError([{ field: "kind", message: "obrigatório" }], { detail: "Tipo de serviço inválido." });
  }
  return assertValidSlotKind(typeof value === "string" ? value : "");
}

export function assertValidServiceDuration(value: unknown): number {
  return assertValidDurationMinutes(typeof value === "number" ? value : Number.NaN);
}
