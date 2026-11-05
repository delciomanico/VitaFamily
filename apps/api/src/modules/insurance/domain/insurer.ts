// Entidade pura `Insurer` (schema.md `insurer_accounts`, ADR-021/BR-ADM-05). Sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";

export type InsurerStatus = "ACTIVE" | "SUSPENDED";

export interface Insurer {
  id: string;
  name: string;
  /** NIF; único (schema.md). */
  taxId: string;
  status: InsurerStatus;
  createdBy?: string;
  createdAt: Date;
}

function requireNonEmpty(value: string, field: string, detail: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError([{ field, message: "não pode ser vazio" }], { detail });
  }
  return trimmed;
}

export function assertValidInsurerName(name: string): string {
  return requireNonEmpty(name, "name", "Nome inválido.");
}

export function assertValidTaxId(taxId: string): string {
  return requireNonEmpty(taxId, "taxId", "NIF inválido.");
}
