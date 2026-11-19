// Avaliação verificada (MK3, BR-MKT-59/60): elegibilidade, janelas e validação do conteúdo. Funções puras; o instante entra por parâmetro.
import { BOOKING_LIMITS, type BookingPaymentStatus, type BookingStatus } from "./booking.js";
import { isPaymentSatisfied } from "./payment.js";

export const REVIEW_LIMITS = { minRating: 1, maxRating: 5, maxComment: 500, maxReply: 500, maxReportNote: 300 } as const;
export type ReviewReportReason = "ABUSE" | "PERSONAL_DATA" | "OFF_TOPIC" | "OTHER";
export const REVIEW_REPORT_REASONS: readonly ReviewReportReason[] = ["ABUSE", "PERSONAL_DATA", "OFF_TOPIC", "OTHER"];

export type ReviewEligibility = { allowed: true } | { allowed: false; reason: "NOT_COMPLETED" | "PAYMENT_NOT_SATISFIED" | "WINDOW_CLOSED" };

/** Pode criar a avaliação: `COMPLETED`, pagamento satisfeito, até 30 dias após `completedAt` (BR-MKT-59). Mapeia para `REVIEW_NOT_ALLOWED`. */
export function checkReviewCreate(booking: { status: BookingStatus; paymentStatus: BookingPaymentStatus; completedAtMs: number | null }, nowMs: number): ReviewEligibility {
  if (booking.status !== "COMPLETED" || booking.completedAtMs === null) return { allowed: false, reason: "NOT_COMPLETED" };
  if (!isPaymentSatisfied(booking.paymentStatus)) return { allowed: false, reason: "PAYMENT_NOT_SATISFIED" };
  if (nowMs > booking.completedAtMs + BOOKING_LIMITS.reviewWindowMs) return { allowed: false, reason: "WINDOW_CLOSED" };
  return { allowed: true };
}

/** Edição só até 7 dias depois da criação (BR-MKT-59). */
export function canEditReview(createdAtMs: number, nowMs: number): boolean {
  return nowMs <= createdAtMs + BOOKING_LIMITS.reviewEditWindowMs;
}

/** Nota inteira 1–5. */
export const isValidRating = (rating: number): boolean => Number.isInteger(rating) && rating >= REVIEW_LIMITS.minRating && rating <= REVIEW_LIMITS.maxRating;

/** Texto simples: sem caracteres de controlo (exceto `\n` e `\t`) nem marcas HTML; aparado não vazio quando obrigatório (BR-MKT-59). */
export function isPlainText(text: string, maxLength: number): boolean {
  if (Array.from(text).length > maxLength) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return false;
  return !/[<>]/.test(text);
}

/** Sinal de avaliações: o comentário oculto continua a contar a nota (BR-MKT-60/61); a lista pública devolve `commentHidden` sem texto. */
export function publicComment(review: { comment: string | null; commentHiddenAtMs: number | null }): { comment: string | null; commentHidden: boolean } {
  const hidden = review.commentHiddenAtMs !== null;
  return { comment: hidden ? null : review.comment, commentHidden: hidden };
}
