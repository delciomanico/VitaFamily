// Regras puras do módulo: papéis (TC-AZ-SEG-01), estados de beneficiário/apólice (TC-SEG-02) e código de reclamação (BR-SEG-20).
import { describe, expect, it } from "vitest";
import { assertModuleEnabled, assertOpsRole, type OpsRole } from "./access.js";
import { assertBeneficiaryTransition, CLAIM_CODE_ALPHABET, formatClaimCode, generateCardNumber, generateClaimCode, hashClaimCode, parseBeneficiaryInput, type BeneficiaryStatus } from "./beneficiary.js";
import { assertPolicyEditable, assertPolicyTransition, parsePolicyInput, type Policy, type PolicyStatus } from "./policy.js";

/** Código do erro de domínio lançado por `fn` (ou `undefined` se não lançar). */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}


describe("papéis (authorization.md §8.2b, Fase A)", () => {
  const ROLES: OpsRole[] = ["INSURANCE_ADMIN", "INSURANCE_AGENT", "BENEFICIARY_MANAGER", "AUTHORIZATION_ANALYST", "CLAIMS_MANAGER", "FINANCE_MANAGER"];
  const allowed: Record<OpsRole, { read: boolean; write: boolean }> = {
    INSURANCE_ADMIN: { read: true, write: true },
    BENEFICIARY_MANAGER: { read: true, write: true },
    AUTHORIZATION_ANALYST: { read: true, write: false },
    CLAIMS_MANAGER: { read: true, write: false },
    FINANCE_MANAGER: { read: true, write: false },
    INSURANCE_AGENT: { read: false, write: false },
  };
  it.each(ROLES.flatMap((role) => (["read", "write"] as const).map((access) => [role, access] as const)))("%s / %s", (role, access) => {
    if (allowed[role][access]) expect(codeOf(() => { assertOpsRole(role, access); })).toBeUndefined();
    else expect(codeOf(() => { assertOpsRole(role, access); })).toBe("FORBIDDEN");
  });
  it("módulo desativado ⇒ NOT_FOUND", () => {
    expect(codeOf(() => { assertModuleEnabled(false); })).toBe("NOT_FOUND");
    expect(codeOf(() => { assertModuleEnabled(true); })).toBeUndefined();
  });
});

describe("beneficiário", () => {
  const ok: [BeneficiaryStatus, string, string | undefined][] = [
    ["PENDING", "ACTIVE", undefined],
    ["ACTIVE", "SUSPENDED", "motivo"],
    ["SUSPENDED", "ACTIVE", undefined],
    ["PENDING", "CANCELLED", "motivo"],
    ["ACTIVE", "CANCELLED", "motivo"],
    ["SUSPENDED", "CANCELLED", "motivo"],
  ];
  it.each(ok)("%s → %s permitido", (from, to, note) => {
    expect(assertBeneficiaryTransition(from, to, note)).toBe(to);
  });
  it.each([
    ["PENDING", "SUSPENDED"],
    ["ACTIVE", "ACTIVE"],
    ["CANCELLED", "ACTIVE"],
  ] as const)("%s → %s ⇒ INVALID_STATE_TRANSITION", (from, to) => {
    expect(codeOf(() => assertBeneficiaryTransition(from, to, "n"))).toBe("INVALID_STATE_TRANSITION");
  });
  it.each(["SUSPENDED", "CANCELLED"])("%s exige nota", (to) => {
    expect(codeOf(() => assertBeneficiaryTransition("ACTIVE", to, undefined))).toBe("VALIDATION_ERROR");
  });
  it("estado alvo inválido (PENDING/EXPIRED) ⇒ VALIDATION_ERROR", () => {
    expect(codeOf(() => assertBeneficiaryTransition("ACTIVE", "PENDING", "n"))).toBe("VALIDATION_ERROR");
  });

  it("relationship=HOLDER ⇔ sem holderId", () => {
    const base = { name: "A", idDocumentType: "bi", idDocumentNumber: "1", birthDate: "1990-01-01" };
    expect(parseBeneficiaryInput({ ...base, relationship: "HOLDER" })).toMatchObject({ idDocumentType: "BI", holderId: null });
    expect(codeOf(() => parseBeneficiaryInput({ ...base, relationship: "HOLDER", holderId: "x" }))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseBeneficiaryInput({ ...base, relationship: "CHILD" }))).toBe("VALIDATION_ERROR");
  });

  it("nº de cartão e código de reclamação: formato, aleatoriedade e HMAC com separação de domínio", () => {
    expect(generateCardNumber()).toMatch(/^VF\d{14}$/);
    const code = generateClaimCode();
    expect(code).toMatch(new RegExp(`^[${CLAIM_CODE_ALPHABET}]{8}$`));
    expect(formatClaimCode(code)).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const h = hashClaimCode("segredo", code);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClaimCode("segredo", formatClaimCode(code).toLowerCase())).toBe(h);
    expect(hashClaimCode("outro", code)).not.toBe(h);
    expect(h).not.toContain(code);
  });
});

describe("apólice", () => {
  const policy = (status: PolicyStatus): Policy => ({ id: "p", insurerId: "i", number: "N", planId: "pl", planName: "P", planVersion: 1, companyId: null, holderId: "h", validFrom: "2026-01-01", validTo: "2026-12-31", status, statusNote: null, createdAt: new Date() });
  it.each([
    ["DRAFT", "ACTIVE", "ACTIVE", undefined],
    ["ACTIVE", "SUSPENDED", "ACTIVE", "n"],
    ["SUSPENDED", "ACTIVE", "ACTIVE", undefined],
    ["DRAFT", "CANCELLED", "DRAFT", "n"],
    ["ACTIVE", "CANCELLED", "ACTIVE", "n"],
    ["SUSPENDED", "CANCELLED", "ACTIVE", "n"],
  ] as const)("%s → %s permitido", (from, to, plan, note) => {
    expect(assertPolicyTransition(policy(from), plan, to, note)).toBe(to);
  });
  it.each([
    ["DRAFT", "SUSPENDED"],
    ["EXPIRED", "ACTIVE"],
    ["CANCELLED", "ACTIVE"],
    ["ACTIVE", "ACTIVE"],
  ] as const)("%s → %s ⇒ INVALID_STATE_TRANSITION", (from, to) => {
    expect(codeOf(() => assertPolicyTransition(policy(from), "ACTIVE", to, "n"))).toBe("INVALID_STATE_TRANSITION");
  });
  it("EXPIRED nunca é aceite por este caminho (só o job)", () => {
    expect(codeOf(() => assertPolicyTransition(policy("ACTIVE"), "ACTIVE", "EXPIRED", "n"))).toBe("VALIDATION_ERROR");
  });
  it("DRAFT→ACTIVE exige plano ACTIVE (senão CONFLICT)", () => {
    expect(codeOf(() => assertPolicyTransition(policy("DRAFT"), "DRAFT", "ACTIVE", undefined))).toBe("CONFLICT");
  });
  it("edição: estado final ⇒ CONFLICT; planId só em DRAFT", () => {
    expect(codeOf(() => { assertPolicyEditable(policy("EXPIRED"), { validTo: "2027-01-01" }); })).toBe("CONFLICT");
    expect(codeOf(() => { assertPolicyEditable(policy("ACTIVE"), { planId: "outro" }); })).toBe("CONFLICT");
    expect(codeOf(() => { assertPolicyEditable(policy("ACTIVE"), { validTo: "2027-01-01" }); })).toBeUndefined();
    expect(codeOf(() => { assertPolicyEditable(policy("DRAFT"), { planId: "outro" }); })).toBeUndefined();
  });
  it("validTo < validFrom ⇒ VALIDATION_ERROR", () => {
    expect(codeOf(() => parsePolicyInput({ planId: "p", holderId: "h", number: "N", validFrom: "2026-02-01", validTo: "2026-01-01" }))).toBe("VALIDATION_ERROR");
  });
});
