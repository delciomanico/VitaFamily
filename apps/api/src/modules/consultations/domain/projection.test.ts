// Projeção estado → phase/hint do ActFact de BOOKING (TC-MKT-88 (U); state-machines.md 1b) e elegibilidade da avaliação (TC-MKT-95 (U)).
import { describe, expect, it } from "vitest";
import { BOOKING_LIMITS, BOOKING_STATUSES, type BookingPaymentStatus, type BookingStatus } from "./booking.js";
import { deriveBookingHint, projectBookingPhase } from "./projection.js";
import { canEditReview, checkReviewCreate, isPlainText, isValidRating, publicComment } from "./review.js";

const NOW = Date.UTC(2026, 11, 1, 10, 0);
const DAY = 86_400_000;
const PAYMENTS: BookingPaymentStatus[] = ["NOT_REQUIRED", "AWAITING_PROOF", "PROOF_SUBMITTED", "CONFIRMED", "REJECTED", "DISPUTED"];

describe("projectBookingPhase", () => {
  it.each([
    ["REQUESTED", "PENDING"],
    ["CONFIRMED", "SCHEDULED"],
    ["COMPLETED", "DONE"],
    ["NO_SHOW", "NO_SHOW"],
    ["CANCELLED", "CANCELLED"],
    ["REJECTED", "CANCELLED"],
  ] as const)("%s => %s", (status, phase) => {
    expect(projectBookingPhase(status)).toBe(phase);
  });
  it("totalidade: todos os estados têm fase e nunca IN_PROGRESS", () => {
    for (const s of BOOKING_STATUSES) expect(["PENDING", "SCHEDULED", "DONE", "NO_SHOW", "CANCELLED"]).toContain(projectBookingPhase(s));
  });
});

describe("deriveBookingHint: tabela total estado × pagamento", () => {
  const completedAt = NOW - 2 * DAY;
  const hint = (status: BookingStatus, paymentStatus: BookingPaymentStatus, over: { hasReview?: boolean; completedAtMs?: number | null; now?: number } = {}) =>
    deriveBookingHint({ status, paymentStatus, completedAtMs: over.completedAtMs === undefined ? (status === "COMPLETED" ? completedAt : null) : over.completedAtMs, hasReview: over.hasReview ?? false }, over.now ?? NOW);

  it.each([
    ["CONFIRMED", "AWAITING_PROOF", "PAYMENT_PROOF_DUE"],
    ["CONFIRMED", "REJECTED", "PAYMENT_PROOF_DUE"],
    ["CONFIRMED", "PROOF_SUBMITTED", "PAYMENT_UNDER_REVIEW"],
    ["CONFIRMED", "DISPUTED", "PAYMENT_DISPUTED"],
    ["CONFIRMED", "CONFIRMED", null],
    ["CONFIRMED", "NOT_REQUIRED", null], // confirmada e ainda não concluída: sem avaliação possível
    ["COMPLETED", "AWAITING_PROOF", "PAYMENT_PROOF_DUE"],
    ["COMPLETED", "REJECTED", "PAYMENT_PROOF_DUE"],
    ["COMPLETED", "PROOF_SUBMITTED", "PAYMENT_UNDER_REVIEW"],
    ["COMPLETED", "DISPUTED", "PAYMENT_DISPUTED"],
    ["COMPLETED", "CONFIRMED", "REVIEW_DUE"],
    ["COMPLETED", "NOT_REQUIRED", "REVIEW_DUE"],
  ] as const)("%s + %s => %s", (status, payment, esperado) => {
    expect(hint(status, payment)).toBe(esperado);
  });

  it("REQUESTED, REJECTED, CANCELLED e NO_SHOW nunca têm hint, qualquer que seja o pagamento", () => {
    for (const status of ["REQUESTED", "REJECTED", "CANCELLED", "NO_SHOW"] as const) for (const p of PAYMENTS) expect(hint(status, p)).toBeNull();
  });

  it("REVIEW_DUE: some com avaliação feita, com a janela de 30 dias fechada ou sem completedAt", () => {
    expect(hint("COMPLETED", "CONFIRMED", { hasReview: true })).toBeNull();
    expect(hint("COMPLETED", "CONFIRMED", { completedAtMs: NOW - 30 * DAY })).toBe("REVIEW_DUE");
    expect(hint("COMPLETED", "CONFIRMED", { completedAtMs: NOW - 30 * DAY - 1 })).toBeNull();
    expect(hint("COMPLETED", "CONFIRMED", { completedAtMs: null })).toBeNull();
  });
});

describe("checkReviewCreate (BR-MKT-59)", () => {
  const completedAt = NOW - 10 * DAY;
  const base = { status: "COMPLETED" as BookingStatus, paymentStatus: "CONFIRMED" as BookingPaymentStatus, completedAtMs: completedAt };

  it.each(BOOKING_STATUSES.filter((s) => s !== "COMPLETED"))("marcação %s nunca é avaliável", (status) => {
    expect(checkReviewCreate({ ...base, status }, NOW)).toEqual({ allowed: false, reason: "NOT_COMPLETED" });
  });

  it.each(PAYMENTS)("COMPLETED com pagamento %s", (paymentStatus) => {
    const r = checkReviewCreate({ ...base, paymentStatus }, NOW);
    expect(r.allowed).toBe(paymentStatus === "CONFIRMED" || paymentStatus === "NOT_REQUIRED");
    if (!r.allowed) expect(r.reason).toBe("PAYMENT_NOT_SATISFIED");
  });

  it("janela de 30 dias após completedAt (inclusiva no limite)", () => {
    expect(checkReviewCreate({ ...base, completedAtMs: NOW - 30 * DAY }, NOW).allowed).toBe(true);
    expect(checkReviewCreate({ ...base, completedAtMs: NOW - 30 * DAY - 1 }, NOW)).toEqual({ allowed: false, reason: "WINDOW_CLOSED" });
  });

  it("COMPLETED sem completedAt não é avaliável (dado inconsistente tratado de forma fechada)", () => {
    expect(checkReviewCreate({ ...base, completedAtMs: null }, NOW).allowed).toBe(false);
  });

  it("edição até 7 dias depois da criação (inclusivo)", () => {
    expect(canEditReview(NOW - 7 * DAY, NOW)).toBe(true);
    expect(canEditReview(NOW - 7 * DAY - 1, NOW)).toBe(false);
    expect(BOOKING_LIMITS.reviewEditWindowMs).toBe(7 * DAY);
  });
});

describe("conteúdo da avaliação", () => {
  it.each([[0, false], [1, true], [3, true], [5, true], [6, false], [2.5, false], [Number.NaN, false], [-1, false]])("nota %s => %s", (n, esperado) => {
    expect(isValidRating(n)).toBe(esperado);
  });

  it.each([
    ["Foi ótimo", 500, true],
    ["a".repeat(500), 500, true],
    ["a".repeat(501), 500, false],
    ["linha 1\nlinha 2", 500, true],
    ["controlo\u0007", 500, false],
    ["<b>html</b>", 500, false],
    ["😀".repeat(500), 500, true], // conta caracteres, não unidades UTF-16
    ["", 500, true],
  ])("texto simples %j (máx. %i) => %s", (text, max, esperado) => {
    expect(isPlainText(text, max)).toBe(esperado);
  });

  it("comentário oculto sai sem texto e com commentHidden=true; a nota nunca é tocada", () => {
    expect(publicComment({ comment: "x", commentHiddenAtMs: null })).toEqual({ comment: "x", commentHidden: false });
    expect(publicComment({ comment: "x", commentHiddenAtMs: NOW })).toEqual({ comment: null, commentHidden: true });
    expect(publicComment({ comment: null, commentHiddenAtMs: null })).toEqual({ comment: null, commentHidden: false });
  });
});
