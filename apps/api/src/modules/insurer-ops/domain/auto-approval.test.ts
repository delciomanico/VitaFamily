// TC-DEC-02 (BR-AUT-03/23, Q-A1): `podeAutoAprovar` é pura; tabela de verdade sobre regras (dados) e a `CoverageDecision`.
import { describe, expect, it } from "vitest";
import { findApplicableRule, podeAutoAprovar, AUTO_APPROVAL_CHECKS, type AutoApprovalCoverage, type AutoApprovalRule } from "./auto-approval.js";

const SERVICE = "svc-1";
const KIND = "kind-1";
const rule = (over: Partial<AutoApprovalRule> = {}): AutoApprovalRule => ({ id: "r1", name: "Consultas", serviceKindId: null, serviceId: SERVICE, maxAmountMinor: 50_000, active: true, ...over });
const covered: AutoApprovalCoverage = { reason: "COVERED", requiresAuthorization: true, remainingMinor: null };
const request = (over: Partial<Parameters<typeof podeAutoAprovar>[0]> = {}) => ({ isAppeal: false, serviceId: SERVICE, serviceKindId: KIND, requestedAmountMinor: 25_050, ...over });
const failing = (trace: ReturnType<typeof podeAutoAprovar>) => trace.checks.filter((c) => !c.ok).map((c) => `${c.check}:${c.reason}`);

describe("podeAutoAprovar (TC-DEC-02)", () => {
  it("coberto + exige autorização + regra do serviço com max ≥ valor ⇒ ok, com as 4 verificações no rasto", () => {
    const trace = podeAutoAprovar(request(), covered, [rule()]);
    expect(trace).toMatchObject({ ok: true, ruleId: "r1", ruleName: "Consultas" });
    expect(trace.checks.map((c) => c.check)).toEqual([...AUTO_APPROVAL_CHECKS]);
    expect(trace.checks.every((c) => c.ok && c.reason === "OK")).toBe(true);
  });

  it("recurso ⇒ nunca (IS_APPEAL), mesmo com tudo o resto ok", () => {
    const trace = podeAutoAprovar(request({ isAppeal: true }), covered, [rule()]);
    expect(trace.ok).toBe(false);
    expect(failing(trace)).toEqual(["NOT_APPEAL:IS_APPEAL"]);
  });

  it.each(["WAITING_PERIOD", "LIMIT_EXHAUSTED"] as const)("%s nunca se auto-aprova, mesmo com regra (Q-A1)", (reason) => {
    const trace = podeAutoAprovar(request(), { ...covered, reason }, [rule()]);
    expect(trace.ok).toBe(false);
    expect(failing(trace)).toEqual([`COVERED_REQUIRES_AUTHORIZATION:${reason}`]);
  });

  it.each(["NOT_IN_PLAN", "EXCLUDED", "SERVICE_INACTIVE", "BENEFICIARY_NOT_ACTIVE", "POLICY_NOT_ACTIVE", "OUTSIDE_POLICY_PERIOD"] as const)("razão vermelha %s ⇒ não", (reason) => {
    expect(podeAutoAprovar(request(), { ...covered, reason }, [rule()]).ok).toBe(false);
  });

  it("valor = max ⇒ ok; valor > max ⇒ AMOUNT_ABOVE_RULE_MAX", () => {
    expect(podeAutoAprovar(request({ requestedAmountMinor: 50_000 }), covered, [rule()]).ok).toBe(true);
    expect(failing(podeAutoAprovar(request({ requestedAmountMinor: 50_001 }), covered, [rule()]))).toEqual(["RULE_MATCH:AMOUNT_ABOVE_RULE_MAX"]);
  });

  it("valor > saldo ⇒ AMOUNT_ABOVE_LIMIT; sem teto ⇒ não limita", () => {
    expect(failing(podeAutoAprovar(request(), { ...covered, remainingMinor: 25_049 }, [rule()]))).toEqual(["WITHIN_LIMIT:AMOUNT_ABOVE_LIMIT"]);
    expect(podeAutoAprovar(request(), { ...covered, remainingMinor: 25_050 }, [rule()]).ok).toBe(true);
  });

  it("sem regra (ou só inativa, ou de outro alvo) ⇒ NO_RULE_FOR_SERVICE e o rasto não tem regra", () => {
    for (const rules of [[], [rule({ active: false })], [rule({ serviceId: "outro" })], [rule({ serviceId: null, serviceKindId: "outro" })]]) {
      const trace = podeAutoAprovar(request(), covered, rules);
      expect(failing(trace)).toEqual(["RULE_MATCH:NO_RULE_FOR_SERVICE"]);
      expect(trace.ruleId).toBeNull();
    }
  });

  it("a regra do SERVIÇO precede a do TIPO: a de serviço com max menor restringe (não cai para o tipo)", () => {
    const byKind = rule({ id: "k", name: "Tipo", serviceId: null, serviceKindId: KIND, maxAmountMinor: 1_000_000 });
    const byService = rule({ id: "s", maxAmountMinor: 10_000 });
    expect(findApplicableRule([byKind, byService], request())?.id).toBe("s");
    const trace = podeAutoAprovar(request(), covered, [byKind, byService]);
    expect(failing(trace)).toEqual(["RULE_MATCH:AMOUNT_ABOVE_RULE_MAX"]);
    expect(trace.ruleId).toBe("s");
    // Sem a de serviço, vale a do tipo.
    expect(podeAutoAprovar(request(), covered, [byKind])).toMatchObject({ ok: true, ruleId: "k" });
  });

  it("serviço sem tipo só casa com regra de serviço", () => {
    expect(podeAutoAprovar(request({ serviceKindId: null }), covered, [rule({ serviceId: null, serviceKindId: KIND })]).ok).toBe(false);
  });

  it("o rasto só tem códigos: nenhuma razão tem espaços nem texto livre", () => {
    const trace = podeAutoAprovar(request({ isAppeal: true }), { reason: "LIMIT_EXHAUSTED", requiresAuthorization: true, remainingMinor: 0 }, []);
    for (const check of trace.checks) expect(check.reason).toMatch(/^[A-Z_]+$/);
  });
});
