// Projeção estado → `phase`/`hint` do `ActFact` de `BOOKING` (state-machines.md 1b; TC-MKT-88 (U)). Função pura; `processes` deriva daqui o
// «o que falta» (a tabela de verdade vive em `processes/domain`).
import { BOOKING_LIMITS, type BookingPaymentStatus, type BookingStatus } from "./booking.js";
import { isPaymentSatisfied } from "./payment.js";

export type BookingPhase = "PENDING" | "SCHEDULED" | "DONE" | "NO_SHOW" | "CANCELLED";
export type BookingHint = "PAYMENT_PROOF_DUE" | "PAYMENT_UNDER_REVIEW" | "PAYMENT_DISPUTED" | "REVIEW_DUE";

const PHASE: Record<BookingStatus, BookingPhase> = {
  REQUESTED: "PENDING",
  CONFIRMED: "SCHEDULED",
  COMPLETED: "DONE",
  NO_SHOW: "NO_SHOW",
  CANCELLED: "CANCELLED",
  REJECTED: "CANCELLED",
};

export const projectBookingPhase = (status: BookingStatus): BookingPhase => PHASE[status];

export interface BookingHintFacts {
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  completedAtMs: number | null;
  hasReview: boolean;
}

/** `hint` (aditivo): só `CONFIRMED`/`COMPLETED` o têm; senão nulo. */
export function deriveBookingHint(facts: BookingHintFacts, nowMs: number): BookingHint | null {
  if (facts.status !== "CONFIRMED" && facts.status !== "COMPLETED") return null;
  switch (facts.paymentStatus) {
    case "AWAITING_PROOF":
    case "REJECTED":
      return "PAYMENT_PROOF_DUE";
    case "PROOF_SUBMITTED":
      return "PAYMENT_UNDER_REVIEW";
    case "DISPUTED":
      return "PAYMENT_DISPUTED";
    default:
      break;
  }
  if (facts.status === "COMPLETED" && isPaymentSatisfied(facts.paymentStatus) && !facts.hasReview && facts.completedAtMs !== null && nowMs <= facts.completedAtMs + BOOKING_LIMITS.reviewWindowMs) return "REVIEW_DUE";
  return null;
}
