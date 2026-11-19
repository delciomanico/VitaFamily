// Auxiliares partilhados pelos casos de uso de `messaging` (lado da família, do profissional e do admin).
import { DomainError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import type { LimitDecision } from "../domain/limits.js";
import type { TextError } from "../domain/text.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const TEXT_ERRORS: Record<TextError, string> = { EMPTY: "não pode ser vazio", TOO_LONG: "excede o tamanho máximo", CONTROL_CHARACTER: "contém caracteres de controlo" };

export function invalid(field: string, error: TextError): ValidationError {
  return new ValidationError([{ field, message: TEXT_ERRORS[error] }], { detail: "Dados inválidos." });
}

export function enforce(decision: LimitDecision): void {
  if (decision.ok) return;
  if (decision.kind === "RATE_LIMITED") throw new RateLimitedError(decision.retryAfterMs);
  throw new DomainError("LIMIT_EXCEEDED", { detail: decision.detail });
}

export function parseLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) throw new DomainError("MALFORMED_REQUEST", { detail: "Limite inválido." });
  return value;
}

