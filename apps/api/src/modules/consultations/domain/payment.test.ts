// Pagamento declarativo e comprovativos (TC-MKT-90..94 (U); BR-MKT-56..58).
import { describe, expect, it } from "vitest";
import type { BookingPaymentStatus, BookingStatus } from "./booking.js";
import { canShowPaymentInstructions, checkProofUpload, isPaymentFrozen, isPaymentSatisfied, nextPaymentStatus, nextProofStatus, PROOF_LIMITS, type PaymentEvent, type ProofStatus } from "./payment.js";

const PAYMENTS: BookingPaymentStatus[] = ["NOT_REQUIRED", "AWAITING_PROOF", "PROOF_SUBMITTED", "CONFIRMED", "REJECTED", "DISPUTED"];
const EVENTS: PaymentEvent[] = ["SUBMIT_PROOF", "PROFESSIONAL_CONFIRM", "PROFESSIONAL_REJECT", "DISPUTE", "ADMIN_CONFIRM_PAYMENT", "ADMIN_UPHOLD_REJECTION"];
const LEGAL: Record<string, BookingPaymentStatus> = {
  "AWAITING_PROOF/SUBMIT_PROOF": "PROOF_SUBMITTED",
  "REJECTED/SUBMIT_PROOF": "PROOF_SUBMITTED",
  "PROOF_SUBMITTED/PROFESSIONAL_CONFIRM": "CONFIRMED",
  "PROOF_SUBMITTED/PROFESSIONAL_REJECT": "REJECTED",
  "REJECTED/DISPUTE": "DISPUTED",
  "DISPUTED/ADMIN_CONFIRM_PAYMENT": "CONFIRMED",
  "DISPUTED/ADMIN_UPHOLD_REJECTION": "REJECTED",
};

describe("nextPaymentStatus: tabela total (marcação CONFIRMED) — só as 7 transições do contrato são legais", () => {
  const cases = PAYMENTS.flatMap((p) => EVENTS.map((e) => [p, e] as const));
  it.each(cases)("%s + %s", (payment, event) => {
    const r = nextPaymentStatus("CONFIRMED", payment, event);
    const esperado = LEGAL[`${payment}/${event}`];
    if (esperado) expect(r).toEqual({ ok: true, to: esperado });
    else expect(r).toEqual({ ok: false, reason: "INVALID_STATE" });
  });

  it("CONFIRMED e NOT_REQUIRED são terminais (sem PAID por silêncio nem por tempo)", () => {
    for (const e of EVENTS) {
      expect(nextPaymentStatus("COMPLETED", "CONFIRMED", e).ok).toBe(false);
      expect(nextPaymentStatus("COMPLETED", "NOT_REQUIRED", e).ok).toBe(false);
    }
  });
});

describe("comprovativos só com a marcação CONFIRMED ou COMPLETED; o resto congela", () => {
  it.each<[BookingStatus, string]>([
    ["REQUESTED", "BOOKING_NOT_PAYABLE"],
    ["CONFIRMED", "ok"],
    ["COMPLETED", "ok"],
    ["CANCELLED", "FROZEN"],
    ["REJECTED", "FROZEN"],
    ["NO_SHOW", "FROZEN"],
  ])("SUBMIT_PROOF com a marcação %s => %s", (booking, esperado) => {
    const r = nextPaymentStatus(booking, "AWAITING_PROOF", "SUBMIT_PROOF");
    expect(r.ok ? "ok" : r.reason).toBe(esperado);
  });

  it("marcação cancelada/recusada/falta: nenhuma decisão muda o pagamento (congelado)", () => {
    for (const booking of ["CANCELLED", "REJECTED", "NO_SHOW"] as const) {
      expect(isPaymentFrozen(booking)).toBe(true);
      expect(nextPaymentStatus(booking, "PROOF_SUBMITTED", "PROFESSIONAL_CONFIRM")).toEqual({ ok: false, reason: "FROZEN" });
    }
    expect(isPaymentFrozen("COMPLETED")).toBe(false);
  });
});

describe("estado do comprovativo (BR-MKT-57/58)", () => {
  it.each<[ProofStatus, PaymentEvent, ProofStatus | null]>([
    ["SUBMITTED", "PROFESSIONAL_CONFIRM", "CONFIRMED"],
    ["SUBMITTED", "PROFESSIONAL_REJECT", "REJECTED"],
    ["REJECTED", "DISPUTE", "DISPUTED"],
    ["DISPUTED", "ADMIN_CONFIRM_PAYMENT", "CONFIRMED"],
    ["DISPUTED", "ADMIN_UPHOLD_REJECTION", "REJECTION_UPHELD"],
    ["REJECTION_UPHELD", "DISPUTE", null], // uma disputa por comprovativo
    ["DISPUTED", "DISPUTE", null],
    ["CONFIRMED", "PROFESSIONAL_REJECT", null],
    ["SUBMITTED", "DISPUTE", null],
    ["SUBMITTED", "SUBMIT_PROOF", null],
  ])("%s + %s => %s", (proof, event, esperado) => {
    expect(nextProofStatus(proof, event)).toBe(esperado);
  });

  it.each<[readonly ProofStatus[], string]>([
    [[], "OK"],
    [["REJECTED"], "OK"],
    [["REJECTION_UPHELD", "CONFIRMED"], "OK"],
    [["SUBMITTED"], "PROOF_IN_PROGRESS"],
    [["REJECTED", "DISPUTED"], "PROOF_IN_PROGRESS"],
    [["REJECTED", "REJECTED", "REJECTED", "REJECTED", "REJECTED"], "LIMIT_EXCEEDED"],
    [["REJECTED", "REJECTED", "REJECTED", "REJECTED"], "OK"],
  ])("checkProofUpload(%j) => %s", (existing, esperado) => {
    expect(checkProofUpload(existing)).toBe(esperado);
  });

  it("limites do comprovativo: 10 MB, 5 por marcação, PDF/JPG/PNG", () => {
    expect(PROOF_LIMITS).toMatchObject({ maxFileBytes: 10_485_760, maxPerBooking: 5 });
    expect([...PROOF_LIMITS.allowedMimeTypes]).toEqual(["application/pdf", "image/jpeg", "image/png"]);
  });
});

describe("pagamento satisfeito e instruções de pagamento (BR-MKT-56)", () => {
  it.each([["CONFIRMED", true], ["NOT_REQUIRED", true], ["AWAITING_PROOF", false], ["PROOF_SUBMITTED", false], ["REJECTED", false], ["DISPUTED", false]] as const)("%s => satisfeito %s", (p, esperado) => {
    expect(isPaymentSatisfied(p)).toBe(esperado);
  });

  it.each<[BookingStatus, number, boolean]>([
    ["REQUESTED", 5000, false],
    ["CONFIRMED", 5000, true],
    ["COMPLETED", 5000, true],
    ["CONFIRMED", 0, false],
    ["CANCELLED", 5000, false],
    ["NO_SHOW", 5000, false],
  ])("instruções com a marcação %s e preço %i => %s", (booking, price, esperado) => {
    expect(canShowPaymentInstructions(booking, price)).toBe(esperado);
  });
});
