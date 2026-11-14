// TC-POL-01/02 (BR-SEG-40): resolução serviço > seguradora > omissão e limites.
import { describe, expect, it } from "vitest";
import { assertServiceScope, assertWithinLimits, describePolicySetting, requireDefinition, resolvePolicySetting, type PolicySettingDefinition, type StoredPolicySetting } from "./policy-setting.js";

const DECISION: PolicySettingDefinition = { key: "AUTHORIZATION_DECISION_HOURS", unit: "HOURS", min: 24, max: 120, defaultValue: 48, allowsServiceScope: true };
const APPEAL: PolicySettingDefinition = { key: "APPEAL_REQUEST_DAYS", unit: "DAYS", min: 5, max: 30, defaultValue: 15, allowsServiceScope: false };
const insurer: StoredPolicySetting = { key: DECISION.key, serviceId: null, value: 72 };
const service: StoredPolicySetting = { key: DECISION.key, serviceId: "s1", value: 24, serviceCode: "CONS", serviceName: "Consulta" };

describe("resolvePolicySetting (TC-POL-01)", () => {
  it("serviço > seguradora > omissão do Vita", () => {
    expect(resolvePolicySetting(DECISION, [])).toEqual({ value: 48, source: "DEFAULT" });
    expect(resolvePolicySetting(DECISION, [insurer])).toEqual({ value: 72, source: "INSURER" });
    expect(resolvePolicySetting(DECISION, [insurer, service], "s1")).toEqual({ value: 24, source: "SERVICE" });
    expect(resolvePolicySetting(DECISION, [insurer, service], "outro")).toEqual({ value: 72, source: "INSURER" });
    expect(resolvePolicySetting(DECISION, [service])).toEqual({ value: 48, source: "DEFAULT" });
  });

  it("outras chaves não interferem; chave sem escopo por serviço ignora exceções", () => {
    expect(resolvePolicySetting(APPEAL, [insurer])).toEqual({ value: 15, source: "DEFAULT" });
    expect(resolvePolicySetting(APPEAL, [{ key: APPEAL.key, serviceId: "s1", value: 9 }], "s1")).toEqual({ value: 15, source: "DEFAULT" });
  });

  it("describePolicySetting: valor efetivo ao nível da seguradora + exceções", () => {
    expect(describePolicySetting(DECISION, [insurer, service])).toMatchObject({ value: 72, source: "INSURER", serviceOverrides: [{ serviceId: "s1", serviceCode: "CONS", serviceName: "Consulta", value: 24 }] });
    expect(describePolicySetting(DECISION, [service])).toMatchObject({ value: 48, source: "DEFAULT" });
  });
});

describe("limites (TC-POL-02)", () => {
  it.each([[24, true], [120, true], [23, false], [121, false], [48.5, false], ["48", false], [null, false]])("AUTHORIZATION_DECISION_HOURS %j ⇒ %s", (value, ok) => {
    if (ok) expect(assertWithinLimits(DECISION, value)).toBe(value);
    else expect(() => assertWithinLimits(DECISION, value)).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR", fields: [expect.objectContaining({ field: "value" })] }) as Error);
  });

  it("mensagem com o intervalo e a unidade", () => {
    expect(() => assertWithinLimits(APPEAL, 31)).toThrowError(expect.objectContaining({ fields: [{ field: "value", message: "entre 5 e 30 dias" }] }) as Error);
  });

  it("serviceId só com escopo por serviço; chave desconhecida ⇒ NOT_FOUND", () => {
    expect(() => { assertServiceScope(DECISION, "s1"); }).not.toThrow();
    expect(() => { assertServiceScope(APPEAL, undefined); }).not.toThrow();
    expect(() => { assertServiceScope(APPEAL, "s1"); }).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }) as Error);
    expect(() => requireDefinition([DECISION], "X")).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }) as Error);
  });
});
