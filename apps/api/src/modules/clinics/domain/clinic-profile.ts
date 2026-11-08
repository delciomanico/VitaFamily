// Perfil institucional da clínica parceira (M14 R, BR-CLN-38): seis campos de texto; `name`/`currency` são só leitura.
// Parcial: ausente = não muda, `null` = limpa. Regras puras, sem I/O. Texto institucional, nunca dados de pacientes.
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";

export const PROFILE_FIELDS = ["displayName", "address", "phone", "email", "openingHours", "description"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const PROFILE_LIMITS: Record<ProfileField, { min: number; max: number }> = {
  displayName: { min: 1, max: 120 },
  address: { min: 0, max: 200 },
  phone: { min: 0, max: 30 },
  email: { min: 0, max: 254 },
  openingHours: { min: 0, max: 500 },
  description: { min: 0, max: 500 },
};

export type ProfilePatch = Partial<Record<ProfileField, string | null>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ClinicProfile {
  name: string;
  displayName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  openingHours: string | null;
  description: string | null;
  currency: string;
}

/** Valida o corpo do `PATCH`: ≥ 1 campo, só os seis campos (nunca `name`/`currency`), limites e e-mail. */
export function parseProfilePatch(body: unknown): ProfilePatch {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError([{ field: "body", message: "objeto esperado" }], { detail: "Dados inválidos." });
  }
  const errors: FieldError[] = [];
  const patch: ProfilePatch = {};
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) {
    errors.push({ field: "body", message: "indique pelo menos um campo" });
  }
  for (const [key, value] of entries) {
    if (!(PROFILE_FIELDS as readonly string[]).includes(key)) {
      errors.push({ field: key, message: "campo não editável" });
      continue;
    }
    const field = key as ProfileField;
    if (value === null) {
      patch[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      errors.push({ field, message: "texto esperado" });
      continue;
    }
    const text = value.trim();
    const { min, max } = PROFILE_LIMITS[field];
    if (text.length > max || (text.length < min && min > 0)) {
      errors.push({ field, message: `entre ${String(min)} e ${String(max)} caracteres` });
      continue;
    }
    if (field === "email" && text.length > 0 && !EMAIL_PATTERN.test(text)) {
      errors.push({ field, message: "e-mail inválido" });
      continue;
    }
    patch[field] = text.length === 0 ? null : text;
  }
  if (errors.length > 0) {
    throw new ValidationError(errors, { detail: "Dados inválidos." });
  }
  return patch;
}
