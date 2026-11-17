// Credenciais do profissional (BR-MKT-17): validação pura dos metadados. O ficheiro valida-se por conteúdo em `file-type.ts`.
import { charLength } from "./text.js";
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";
import { isIsoDate } from "../../../platform/time/index.js";
import type { CredentialKind } from "./requirements.js";

export const CREDENTIAL_KINDS: readonly CredentialKind[] = ["IDENTITY", "PROFESSIONAL_LICENSE", "CERTIFICATION"];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface CredentialMetadata {
  kind: CredentialKind;
  number: string | null;
  issuingBody: string | null;
  /** `AAAA-MM-DD` (dia civil de Luanda) ou `null`. */
  validUntil: string | null;
}

function fail(fields: FieldError[]): never {
  throw new ValidationError(fields, { detail: "Credencial inválida." });
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || charLength(value.trim()) > max) fail([{ field, message: `no máximo ${String(max)} caracteres` }]);
  return value.trim().length === 0 ? null : value.trim();
}

export function validateCredentialMetadata(input: Record<string, unknown>): CredentialMetadata {
  const { kind } = input;
  if (typeof kind !== "string" || !(CREDENTIAL_KINDS as readonly string[]).includes(kind)) {
    fail([{ field: "kind", message: "IDENTITY, PROFESSIONAL_LICENSE ou CERTIFICATION" }]);
  }
  const rawValidUntil = typeof input.validUntil === "string" && input.validUntil.length === 0 ? undefined : input.validUntil;
  if (rawValidUntil !== undefined && rawValidUntil !== null && !isIsoDate(rawValidUntil)) fail([{ field: "validUntil", message: "esperado AAAA-MM-DD" }]);
  return {
    kind: kind as CredentialKind,
    number: optionalText(input.number, "number", 60),
    issuingBody: optionalText(input.issuingBody, "issuingBody", 120),
    validUntil: rawValidUntil ?? null,
  };
}
