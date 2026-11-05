// Entidade pura `ReimbursementClaim` e regras (BR-INS-03/04/05, state-machines.md "ReimbursementClaim").
// Sem I/O.
import { ConflictError, ValidationError, type FieldError } from "../../../platform/errors/index.js";

export type ClaimStatus = "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID";
export type ClaimDecision = "APPROVE" | "REJECT";

export interface ReimbursementClaim {
  id: string;
  policyId: string;
  /** Desnormalizado da apólice (isolamento do portal). */
  insurerId: string;
  amount: number;
  currency: string;
  status: ClaimStatus;
  decisionNote?: string;
  decidedByInsuranceAccountId?: string;
  decidedAt?: Date;
  /** Documentos escolhidos pelo titular (BR-INS-04) — a única superfície visível à seguradora. */
  documentIds: string[];
  createdAt: Date;
}

/** `ReimbursementClaimInput.documentIds` (openapi: minItems 1, maxItems 10). */
export const MIN_CLAIM_DOCUMENTS = 1;
export const MAX_CLAIM_DOCUMENTS = 10;
export const MAX_DECISION_NOTE_LENGTH = 1000;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DEFAULT_CURRENCY = "EUR";

export interface ClaimInputFields {
  amount: unknown;
  currency?: unknown;
  documentIds: unknown;
}

/** BR-INS-03/04: valor > 0 (até 2 casas decimais), moeda ISO-4217 (default EUR), 1–10 documentos distintos. */
export function parseClaimInput(input: ClaimInputFields): { amount: number; currency: string; documentIds: string[] } {
  const errors: FieldError[] = [];
  let amount = 0;
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) {
    errors.push({ field: "amount", message: "tem de ser um valor positivo" });
  } else if (Math.abs(Math.round(input.amount * 100) - input.amount * 100) > 1e-6 || input.amount >= 1e10) {
    errors.push({ field: "amount", message: "máximo 2 casas decimais" });
  } else {
    amount = input.amount;
  }
  let currency = DEFAULT_CURRENCY;
  if (input.currency !== undefined && input.currency !== null) {
    if (typeof input.currency !== "string" || !CURRENCY_RE.test(input.currency)) {
      errors.push({ field: "currency", message: "código ISO 4217 (ex.: EUR)" });
    } else {
      currency = input.currency;
    }
  }
  let documentIds: string[] = [];
  if (!Array.isArray(input.documentIds) || input.documentIds.some((id) => typeof id !== "string")) {
    errors.push({ field: "documentIds", message: "lista de ids de documentos" });
  } else {
    documentIds = [...new Set(input.documentIds as string[])];
    if (documentIds.length < MIN_CLAIM_DOCUMENTS || documentIds.length > MAX_CLAIM_DOCUMENTS || documentIds.length !== input.documentIds.length) {
      errors.push({ field: "documentIds", message: `${String(MIN_CLAIM_DOCUMENTS)} a ${String(MAX_CLAIM_DOCUMENTS)} documentos distintos` });
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(errors, { detail: "Dados inválidos." });
  }
  return { amount, currency, documentIds };
}

/** BR-INS-05: `REJECTED` exige motivo; `APPROVED` aceita nota opcional. Só a partir de `SUBMITTED` (senão `CONFLICT`). */
export function decide(current: ClaimStatus, decision: unknown, note: unknown): { status: "APPROVED" | "REJECTED"; note: string | null } {
  if (decision !== "APPROVE" && decision !== "REJECT") {
    throw new ValidationError([{ field: "decision", message: "APPROVE ou REJECT" }], { detail: "Dados inválidos." });
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    throw new ValidationError([{ field: "note", message: "texto" }], { detail: "Dados inválidos." });
  }
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length > MAX_DECISION_NOTE_LENGTH) {
    throw new ValidationError([{ field: "note", message: `máximo ${String(MAX_DECISION_NOTE_LENGTH)} caracteres` }], { detail: "Dados inválidos." });
  }
  if (decision === "REJECT" && trimmed.length === 0) {
    throw new ValidationError([{ field: "note", message: "o motivo é obrigatório ao rejeitar" }], { detail: "Dados inválidos." });
  }
  if (current !== "SUBMITTED") {
    throw new ConflictError({ detail: "O pedido já foi decidido." });
  }
  return { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", note: trimmed.length > 0 ? trimmed : null };
}

/** `APPROVED -> PAID` (só titular/tutor, BR-INS-05). */
export function assertCanMarkPaid(current: ClaimStatus): void {
  if (current !== "APPROVED") {
    throw new ConflictError({ detail: "Só um pedido aprovado pode ser marcado como pago." });
  }
}

/** Apólice com pedidos em curso (SUBMITTED/APPROVED) não se elimina (openapi `deleteInsurancePolicy`). */
export function isActiveClaimStatus(status: ClaimStatus): boolean {
  return status === "SUBMITTED" || status === "APPROVED";
}
