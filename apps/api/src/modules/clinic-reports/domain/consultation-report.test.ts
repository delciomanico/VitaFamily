// AC-CLN-30 / TC-CLN-21 (regras puras, BR-CLN-41..45): limites por secção, ≥1 secção, controlo, adenda, estados.
import { describe, expect, it } from "vitest";
import { assertBookingAllowsReport, assertEditable, parseAddendumInput, parseReportInput, resolveSharedWithPatient } from "./consultation-report.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("parseReportInput (BR-CLN-41)", () => {
  it("normaliza: aparado, vazio => null, \\r\\n => \\n, sharedWithPatient opcional", () => {
    expect(parseReportInput({ reason: "  Dor \r\n lombar  ", findings: "   ", impression: null, plan: "Repouso" })).toEqual({ reason: "Dor \n lombar", findings: null, impression: null, plan: "Repouso" });
    expect(parseReportInput({ plan: "x", sharedWithPatient: false })).toMatchObject({ sharedWithPatient: false });
  });

  it.each([
    ["reason", 300],
    ["findings", 1500],
    ["impression", 500],
    ["plan", 1500],
  ])("%s aceita %i caracteres e rejeita mais um", (field, max) => {
    expect(parseReportInput({ [field]: "a".repeat(max) })).toMatchObject({ [field]: "a".repeat(max) });
    expect(codeOf(() => parseReportInput({ [field]: "a".repeat(max + 1) }))).toBe("VALIDATION_ERROR");
  });

  it("conta caracteres Unicode, não unidades UTF-16 (como char_length da BD)", () => {
    expect(parseReportInput({ reason: "😀".repeat(300) }).reason).toHaveLength(600);
    expect(codeOf(() => parseReportInput({ reason: "😀".repeat(301) }))).toBe("VALIDATION_ERROR");
  });

  it.each([[{}], [{ reason: "  ", findings: "" }], [{ sharedWithPatient: true }], [null], ["texto"], [[]]])("exige ≥1 secção preenchida: %j", (body) => {
    expect(codeOf(() => parseReportInput(body))).toBe("VALIDATION_ERROR");
  });

  it.each([["\u0000"], ["\u0007"], ["\u001b[31m"], ["\u007f"], ["\u0085"], ["a\tb"]])("rejeita caracteres de controlo (exceto quebra de linha): %j", (text) => {
    expect(codeOf(() => parseReportInput({ findings: text }))).toBe("VALIDATION_ERROR");
  });

  it("rejeita campos desconhecidos e tipos errados; HTML/markdown não são interpretados (guardam-se como texto)", () => {
    expect(codeOf(() => parseReportInput({ reason: "x", html: "<b>" }))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseReportInput({ reason: 5 }))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseReportInput({ reason: "x", sharedWithPatient: "sim" }))).toBe("VALIDATION_ERROR");
    expect(parseReportInput({ reason: "<script>**a**</script>" }).reason).toBe("<script>**a**</script>");
  });
});

describe("parseAddendumInput (BR-CLN-43)", () => {
  it("texto 1–1500; vazio, longo, controlo ou campo extra => VALIDATION_ERROR", () => {
    expect(parseAddendumInput({ text: " Resultado recebido " })).toBe("Resultado recebido");
    expect(parseAddendumInput({ text: "a".repeat(1500) })).toHaveLength(1500);
    for (const body of [{ text: "" }, { text: "   " }, { text: "a".repeat(1501) }, { text: "a\u0000" }, {}, { text: "x", extra: 1 }, null]) {
      expect(codeOf(() => parseAddendumInput(body))).toBe("VALIDATION_ERROR");
    }
  });
});

describe("estados (BR-CLN-41/42)", () => {
  it.each([["SCHEDULED", true], ["COMPLETED", true], ["CANCELLED", false], ["NO_SHOW", false], ["REQUESTED", false], ["REJECTED", false]])("marcação %s admite relatório: %s", (status, allowed) => {
    expect(codeOf(() => { assertBookingAllowsReport(status); })).toBe(allowed ? undefined : "INVALID_STATE_TRANSITION");
  });

  it("o FINAL não se edita (INVALID_STATE_TRANSITION); rascunho e inexistente sim", () => {
    expect(codeOf(() => { assertEditable({ status: "FINAL" }); })).toBe("INVALID_STATE_TRANSITION");
    expect(codeOf(() => { assertEditable({ status: "DRAFT" }); })).toBeUndefined();
    expect(codeOf(() => { assertEditable(null); })).toBeUndefined();
  });

  it.each([
    ["APPOINTMENT", undefined, undefined, true],
    ["APPOINTMENT", false, true, false],
    ["APPOINTMENT", undefined, false, false],
    ["APPOINTMENT", true, false, true],
    ["VISIT", true, true, false],
    ["VISIT", undefined, undefined, false],
  ] as const)("sharedWithPatient (%s, pedido %s, existente %s) => %s (visita manual nunca partilhada)", (kind, requested, existing, expected) => {
    expect(resolveSharedWithPatient(kind, requested, existing)).toBe(expected);
  });
});
