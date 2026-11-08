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
  /** M14 R (BR-CLN-36): recibos de clínica anexados pelo titular (associação simples, sem `Document`/`Encounter`). */
  receiptIds?: string[];
  /** M14 R: referências dos recibos (preenchidas pela `application` no lado do titular). */
  receipts?: ClaimReceiptRef[];
  createdAt: Date;
}

/** Referência a um recibo anexado (`ClaimReceiptRef`, openapi). */
export interface ClaimReceiptRef {
  receiptId: string;
  number: number;
  status: "ISSUED" | "VOIDED";
  totalMinor: number;
  currency: string;
}

/** BR-INS-04 + BR-CLN-36: `documentIds` + `receiptIds` entre 1 e 10 itens no total. */
export const MAX_CLAIM_ITEMS = 10;
export const MAX_CLAIM_RECEIPTS = 10;

/** `ReimbursementClaimInput.documentIds` (openapi: minItems 1, maxItems 10). */
export const MIN_CLAIM_DOCUMENTS = 1;
export const MAX_CLAIM_DOCUMENTS = 10;
export const MAX_DECISION_NOTE_LENGTH = 1000;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DEFAULT_CURRENCY = "EUR";

export interface ClaimInputFields {
  amount: unknown;
  currency?: unknown;
  documentIds?: unknown;
  receiptIds?: unknown;
}

/** BR-INS-03/04: valor > 0 (até 2 casas decimais), moeda ISO-4217 (default EUR), 1–10 documentos distintos. */
export function parseClaimInput(input: ClaimInputFields): { amount: number; currency: string; documentIds: string[]; receiptIds: string[] } {
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
  const parseIds = (raw: unknown, field: string, max: number): string[] => {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) {
      errors.push({ field, message: "lista de ids" });
      return [];
    }
    const ids = [...new Set(raw as string[])];
    if (ids.length > max || ids.length !== raw.length) {
      errors.push({ field, message: `no máximo ${String(max)} ids distintos` });
    }
    return ids;
  };
  const documentIds = parseIds(input.documentIds, "documentIds", MAX_CLAIM_DOCUMENTS);
  const receiptIds = parseIds(input.receiptIds, "receiptIds", MAX_CLAIM_RECEIPTS);
  // BR-INS-04/BR-CLN-36: pelo menos 1 e no máximo 10 itens no total (documentos + recibos).
  if (errors.length === 0 && (documentIds.length + receiptIds.length < MIN_CLAIM_DOCUMENTS || documentIds.length + receiptIds.length > MAX_CLAIM_ITEMS)) {
    errors.push({ field: "documentIds", message: `${String(MIN_CLAIM_DOCUMENTS)} a ${String(MAX_CLAIM_ITEMS)} itens (documentos + recibos)` });
  }
  if (errors.length > 0) {
    throw new ValidationError(errors, { detail: "Dados inválidos." });
  }
  return { amount, currency, documentIds, receiptIds };
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
