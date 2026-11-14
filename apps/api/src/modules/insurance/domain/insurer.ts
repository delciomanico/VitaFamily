// Entidade pura `Insurer` (schema.md `insurer_accounts`, ADR-021/BR-ADM-05). Sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";

export type InsurerStatus = "ACTIVE" | "SUSPENDED";

export interface Insurer {
  id: string;
  name: string;
  /** NIF; único (schema.md). */
  taxId: string;
  status: InsurerStatus;
  /** ISO 4217 (BR-SEG-19, ADR-025/Q1); por omissão `AOA`. */
  currency: string;
  /** ADR-025: módulo operacional ligado pelo Platform Admin. */
  operationalModuleEnabled: boolean;
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

export const DEFAULT_INSURER_CURRENCY = "AOA";

/** BR-SEG-19: código ISO 4217 em maiúsculas (3 letras). */
export function assertValidCurrency(currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError([{ field: "currency", message: "código ISO 4217 (ex.: AOA)" }], { detail: "Moeda inválida." });
  }
  return currency;
}
