// Entidade pura `InsurancePolicy` (entities.md, ADR-021) e normalização/validação dos campos do
// cartão (BR-INS-01). Sem I/O. `cardDocumentId` NÃO é coluna: deriva do `Document` de
// `resourceType=INSURANCE_POLICY` da apólice (schema.md `insurance_policies`, "sem coluna de ficheiro").
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";

export interface InsurancePolicy {
  id: string;
  familyId: string;
  memberId: string;
  /** BR-INS-09: seguradora parceira; sem ela a apólice não admite pedidos. */
  insurerId?: string;
  /** Texto livre (BR-INS-01). */
  insurerName: string;
  policyNumber: string;
  holderName: string;
  /** `YYYY-MM-DD`. */
  validUntil?: string;
  createdAt: Date;
}

/** Limites razoáveis de texto livre (o contrato não fixa; evita abuso de armazenamento). */
export const MAX_POLICY_TEXT_LENGTH = 200;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) {
    return false;
  }
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

/** Texto obrigatório: aparado, não vazio, ≤ MAX. Acrescenta o erro ao `errors` e devolve `undefined` se inválido. */
export function requiredText(field: string, value: unknown, errors: FieldError[]): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ field, message: "obrigatório" });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_POLICY_TEXT_LENGTH) {
    errors.push({ field, message: `máximo ${String(MAX_POLICY_TEXT_LENGTH)} caracteres` });
    return undefined;
  }
  return trimmed;
}

export function optionalDate(field: string, value: unknown, errors: FieldError[]): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== "string" || !isValidIsoDate(value)) {
    errors.push({ field, message: "data inválida (AAAA-MM-DD)" });
    return undefined;
  }
  return value;
}

export function throwIfInvalid(errors: FieldError[]): void {
  if (errors.length > 0) {
    throw new ValidationError(errors, { detail: "Dados inválidos." });
  }
}
