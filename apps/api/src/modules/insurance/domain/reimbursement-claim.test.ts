import { describe, expect, it } from "vitest";
import { assertCanMarkPaid, decide, isActiveClaimStatus, parseClaimInput } from "./reimbursement-claim.js";

/** Código do erro de domínio lançado (ou `undefined` se não lançou). */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("parseClaimInput (BR-INS-03/04)", () => {
  it("aceita valor positivo, moeda por omissão EUR e 1–10 documentos distintos", () => {
    expect(parseClaimInput({ amount: 12.5, documentIds: ["a"] })).toEqual({ amount: 12.5, currency: "EUR", documentIds: ["a"], receiptIds: [] });
  });

  it.each([
    ["valor zero", { amount: 0, documentIds: ["a"] }],
    ["valor negativo", { amount: -1, documentIds: ["a"] }],
    ["valor com 3 casas", { amount: 1.234, documentIds: ["a"] }],
    ["valor não numérico", { amount: "10", documentIds: ["a"] }],
    ["moeda inválida", { amount: 1, currency: "eur", documentIds: ["a"] }],
    ["sem documentos", { amount: 1, documentIds: [] }],
    ["11 documentos", { amount: 1, documentIds: Array.from({ length: 11 }, (_, i) => String(i)) }],
    ["documentos repetidos", { amount: 1, documentIds: ["a", "a"] }],
    ["documentIds não é lista", { amount: 1, documentIds: "a" }],
  ])("rejeita: %s", (_name, input) => {
    expect(codeOf(() => parseClaimInput(input))).toBe("VALIDATION_ERROR");
  });
});

describe("decide (BR-INS-05, state-machines.md)", () => {
  it("APPROVE com ou sem nota; REJECT com motivo", () => {
    expect(decide("SUBMITTED", "APPROVE", undefined)).toEqual({ status: "APPROVED", note: null });
    expect(decide("SUBMITTED", "APPROVE", " ok ")).toEqual({ status: "APPROVED", note: "ok" });
    expect(decide("SUBMITTED", "REJECT", "Fora da cobertura")).toEqual({ status: "REJECTED", note: "Fora da cobertura" });
  });

  it.each([undefined, null, "", "   "])("REJECT sem motivo (%j) ⇒ VALIDATION_ERROR", (note) => {
    expect(codeOf(() => decide("SUBMITTED", "REJECT", note))).toBe("VALIDATION_ERROR");
  });

  it.each(["APPROVED", "REJECTED", "PAID"] as const)("já decidido (%s) ⇒ CONFLICT", (status) => {
    expect(codeOf(() => decide(status, "APPROVE", undefined))).toBe("CONFLICT");
  });

  it("decisão desconhecida ⇒ VALIDATION_ERROR", () => {
    expect(codeOf(() => decide("SUBMITTED", "MAYBE", undefined))).toBe("VALIDATION_ERROR");
  });
});

describe("transições do titular", () => {
  it("só APPROVED -> PAID", () => {
    expect(codeOf(() => {
      assertCanMarkPaid("APPROVED");
    })).toBeUndefined();
    for (const status of ["SUBMITTED", "REJECTED", "PAID"] as const) {
      expect(codeOf(() => {
        assertCanMarkPaid(status);
      })).toBe("CONFLICT");
    }
  });

  it("pedidos em curso são SUBMITTED/APPROVED", () => {
    expect(["SUBMITTED", "APPROVED", "REJECTED", "PAID"].map((s) => isActiveClaimStatus(s as "PAID"))).toEqual([true, true, false, false]);
  });
});
