// Pagamento declarativo e comprovativo (MK3, BR-MKT-56..58; state-machines.md «PaymentStatus da marcação e PaymentProof»).
// O Vita não recebe nem valida dinheiro: nada passa a `CONFIRMED` sem decisão explícita do profissional (ou do admin numa disputa).
import type { BookingPaymentStatus, BookingStatus } from "./booking.js";

export type ProofStatus = "SUBMITTED" | "CONFIRMED" | "REJECTED" | "DISPUTED" | "REJECTION_UPHELD";
export type PaymentEvent = "SUBMIT_PROOF" | "PROFESSIONAL_CONFIRM" | "PROFESSIONAL_REJECT" | "DISPUTE" | "ADMIN_CONFIRM_PAYMENT" | "ADMIN_UPHOLD_REJECTION";

/** Limites de comprovativos (BR-MKT-57; PROPOSTA, OP-99). */
export const PROOF_LIMITS = { maxFileBytes: 10 * 1024 * 1024, maxPerBooking: 5, allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"] } as const;

const PAYMENT_TRANSITIONS: Record<PaymentEvent, { from: readonly BookingPaymentStatus[]; to: BookingPaymentStatus }> = {
  SUBMIT_PROOF: { from: ["AWAITING_PROOF", "REJECTED"], to: "PROOF_SUBMITTED" },
  PROFESSIONAL_CONFIRM: { from: ["PROOF_SUBMITTED"], to: "CONFIRMED" },
  PROFESSIONAL_REJECT: { from: ["PROOF_SUBMITTED"], to: "REJECTED" },
  DISPUTE: { from: ["REJECTED"], to: "DISPUTED" },
  ADMIN_CONFIRM_PAYMENT: { from: ["DISPUTED"], to: "CONFIRMED" },
  ADMIN_UPHOLD_REJECTION: { from: ["DISPUTED"], to: "REJECTED" },
};

const PROOF_TRANSITIONS: Partial<Record<PaymentEvent, { from: readonly ProofStatus[]; to: ProofStatus }>> = {
  PROFESSIONAL_CONFIRM: { from: ["SUBMITTED"], to: "CONFIRMED" },
  PROFESSIONAL_REJECT: { from: ["SUBMITTED"], to: "REJECTED" },
  DISPUTE: { from: ["REJECTED"], to: "DISPUTED" },
  ADMIN_CONFIRM_PAYMENT: { from: ["DISPUTED"], to: "CONFIRMED" },
  ADMIN_UPHOLD_REJECTION: { from: ["DISPUTED"], to: "REJECTION_UPHELD" },
};

/** Com a marcação `CANCELLED`/`REJECTED`/`NO_SHOW` o estado do pagamento congela (sem reembolsos na app). */
export const isPaymentFrozen = (booking: BookingStatus): boolean => booking === "CANCELLED" || booking === "REJECTED" || booking === "NO_SHOW";

export type PaymentCheck = { ok: true; to: BookingPaymentStatus } | { ok: false; reason: "INVALID_STATE" | "FROZEN" | "BOOKING_NOT_PAYABLE" };

/**
 * Próximo `paymentStatus` (BR-MKT-56/58). Comprovativos só com a marcação `CONFIRMED` ou `COMPLETED`; decisões sobre estado que já mudou
 * ⇒ `INVALID_STATE`; marcação cancelada/recusada/falta ⇒ `FROZEN`.
 */
export function nextPaymentStatus(booking: BookingStatus, payment: BookingPaymentStatus, event: PaymentEvent): PaymentCheck {
  if (isPaymentFrozen(booking)) return { ok: false, reason: "FROZEN" };
  const t = PAYMENT_TRANSITIONS[event];
  if (event === "SUBMIT_PROOF" && booking !== "CONFIRMED" && booking !== "COMPLETED") return { ok: false, reason: "BOOKING_NOT_PAYABLE" };
  if (!t.from.includes(payment)) return { ok: false, reason: "INVALID_STATE" };
  return { ok: true, to: t.to };
}

/** Próximo estado do comprovativo para o evento (`null` se o evento não o altera ou o estado de origem não serve; ex.: disputar duas vezes). */
export function nextProofStatus(proof: ProofStatus, event: PaymentEvent): ProofStatus | null {
  const t = PROOF_TRANSITIONS[event];
  return t?.from.includes(proof) ? t.to : null;
}

/** Comprovativo «em curso» (um só por marcação, BR-MKT-57). */
export const isProofInProgress = (proof: ProofStatus): boolean => proof === "SUBMITTED" || proof === "DISPUTED";

export type ProofUploadCheck = "OK" | "PROOF_IN_PROGRESS" | "LIMIT_EXCEEDED";

/** Regras de contagem do upload (BR-MKT-57): um só em curso e no máximo 5 no total. */
export function checkProofUpload(existing: readonly ProofStatus[]): ProofUploadCheck {
  if (existing.some(isProofInProgress)) return "PROOF_IN_PROGRESS";
  if (existing.length >= PROOF_LIMITS.maxPerBooking) return "LIMIT_EXCEEDED";
  return "OK";
}

/** «Pagamento satisfeito» para a avaliação (BR-MKT-56/59): `CONFIRMED` ou `NOT_REQUIRED`. */
export const isPaymentSatisfied = (payment: BookingPaymentStatus): boolean => payment === "CONFIRMED" || payment === "NOT_REQUIRED";

/** Instruções de pagamento só a partir de `CONFIRMED`, com preço > 0 (BR-MKT-56). */
export function canShowPaymentInstructions(booking: BookingStatus, priceKz: number): boolean {
  return priceKz > 0 && (booking === "CONFIRMED" || booking === "COMPLETED");
}
