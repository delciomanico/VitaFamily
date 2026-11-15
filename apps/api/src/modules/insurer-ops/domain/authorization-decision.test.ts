// TC-DEC-05/16 (BR-AUT-04/07/17/23): validação pura da aprovação e dos corpos da decisão e das regras.
import { describe, expect, it } from "vitest";
import { decideApproval, parseApproveInput, parseAssignInput, parseReasonInput, parseRuleInput, parseRulePatch } from "./authorization-decision.js";

const NOW = new Date("2026-11-14T10:00:00Z");
const REQUEST = { requestedAmount: 250.5, expectedOn: "2026-11-20" };
const VALIDITY = { defaultDays: 30, maxDays: 365 };
const covered = { reason: "COVERED" as const, requiresAuthorization: true, remainingMinor: null };
const U = "11111111-1111-4111-8111-111111111111";

/** Campo do VALIDATION_ERROR lançado (ou `undefined`). */
const failedField = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { fields?: { field: string }[] }).fields?.[0]?.field;
  }
  return undefined;
};

describe("decideApproval", () => {
  it("omissões: valor = pedido; validade = fim do dia de expectedOn + 30 d (política em dados: com 60 d muda)", () => {
    expect(decideApproval(parseApproveInput(undefined), REQUEST, covered, VALIDITY, NOW)).toMatchObject({ authorizedAmount: 250.5, partial: false, override: false });
    expect(decideApproval({ authorizedAmount: null, validUntil: null, note: null, overrideReason: null }, REQUEST, covered, VALIDITY, NOW).validUntil.toISOString()).toBe("2026-12-20T23:59:59.999Z");
    expect(decideApproval({ authorizedAmount: null, validUntil: null, note: null, overrideReason: null }, REQUEST, covered, { ...VALIDITY, defaultDays: 60 }, NOW).validUntil.toISOString()).toBe("2027-01-19T23:59:59.999Z");
  });

  it("valor acima do pedido ou do saldo ⇒ authorizedAmount; ≤ 0 já falha no parse", () => {
    const input = (authorizedAmount: number) => ({ authorizedAmount, validUntil: null, note: "x", overrideReason: null });
    expect(failedField(() => decideApproval(input(250.51), REQUEST, covered, VALIDITY, NOW))).toBe("authorizedAmount");
    expect(failedField(() => decideApproval(input(100.01), REQUEST, { ...covered, remainingMinor: 10_000 }, VALIDITY, NOW))).toBe("authorizedAmount");
    expect(decideApproval(input(100), REQUEST, { ...covered, remainingMinor: 10_000 }, VALIDITY, NOW).authorizedAmount).toBe(100);
    for (const bad of [0, -1]) expect(failedField(() => parseApproveInput({ authorizedAmount: bad }))).toBe("authorizedAmount");
  });

  it("em parte exige note (visível); com note ⇒ partial", () => {
    expect(failedField(() => decideApproval({ authorizedAmount: 100, validUntil: null, note: null, overrideReason: null }, REQUEST, covered, VALIDITY, NOW))).toBe("note");
    expect(decideApproval({ authorizedAmount: 100, validUntil: null, note: "Só parte", overrideReason: null }, REQUEST, covered, VALIDITY, NOW).partial).toBe(true);
  });

  it.each(["WAITING_PERIOD", "LIMIT_EXHAUSTED"] as const)("%s exige overrideReason INTERNO; com ele aprova com override", (reason) => {
    const coverage = { ...covered, reason };
    expect(failedField(() => decideApproval(parseApproveInput({}), REQUEST, coverage, VALIDITY, NOW))).toBe("overrideReason");
    expect(decideApproval(parseApproveInput({ overrideReason: "Exceção" }), REQUEST, coverage, VALIDITY, NOW).override).toBe(true);
  });

  it.each(["NOT_IN_PLAN", "EXCLUDED", "SERVICE_INACTIVE", "POLICY_NOT_ACTIVE", "BENEFICIARY_NOT_ACTIVE", "OUTSIDE_POLICY_PERIOD"] as const)("cobertura vermelha agora (%s) ⇒ coverage", (reason) => {
    expect(failedField(() => decideApproval(parseApproveInput({}), REQUEST, { ...covered, reason }, VALIDITY, NOW))).toBe("coverage");
  });

  it("validUntil: tem de ser futura e até expectedOn + o máximo da chave", () => {
    const withValidUntil = (iso: string) => decideApproval(parseApproveInput({ validUntil: iso }), REQUEST, covered, VALIDITY, NOW);
    expect(failedField(() => withValidUntil("2026-11-14T10:00:00Z"))).toBe("validUntil");
    expect(failedField(() => withValidUntil("2027-11-21T00:00:00Z"))).toBe("validUntil");
    expect(withValidUntil("2027-11-20T23:59:59.999Z").validUntil.toISOString()).toBe("2027-11-20T23:59:59.999Z");
  });
});

describe("corpos", () => {
  it("rejeita campos desconhecidos (nunca diagnóstico, C2) e texto vazio ou longo", () => {
    expect(failedField(() => parseApproveInput({ diagnosis: "x" }))).toBe("diagnosis");
    expect(failedField(() => parseReasonInput({ reason: "x", icd: "I10" }))).toBe("icd");
    expect(failedField(() => parseReasonInput({ reason: "  " }))).toBe("reason");
    expect(failedField(() => parseReasonInput({ reason: "x".repeat(501) }))).toBe("reason");
    expect(failedField(() => parseApproveInput({ note: "x".repeat(201) }))).toBe("note");
  });

  it("assign: omitido, uuid ou null", () => {
    expect(parseAssignInput({})).toEqual({ analystId: undefined });
    expect(parseAssignInput({ analystId: null })).toEqual({ analystId: null });
    expect(parseAssignInput({ analystId: U })).toEqual({ analystId: U });
    expect(failedField(() => parseAssignInput({ analystId: "x" }))).toBe("analystId");
  });

  it("regra: exatamente um alvo; maxAmount > 0; nome 1–80; o PATCH não muda o alvo", () => {
    expect(parseRuleInput({ name: "R", serviceId: U, maxAmount: 100 })).toMatchObject({ serviceKindId: null, serviceId: U, active: true });
    expect(failedField(() => parseRuleInput({ name: "R", maxAmount: 100 }))).toBe("serviceKindId");
    expect(failedField(() => parseRuleInput({ name: "R", serviceId: U, serviceKindId: U, maxAmount: 100 }))).toBe("serviceKindId");
    expect(failedField(() => parseRuleInput({ name: "R", serviceId: U, maxAmount: 0 }))).toBe("maxAmount");
    expect(failedField(() => parseRuleInput({ name: "x".repeat(81), serviceId: U, maxAmount: 1 }))).toBe("name");
    expect(parseRulePatch({ active: false })).toEqual({ active: false });
    expect(failedField(() => parseRulePatch({ serviceId: U }))).toBe("serviceId");
    expect(failedField(() => parseRulePatch({}))).toBe("body");
  });
});
