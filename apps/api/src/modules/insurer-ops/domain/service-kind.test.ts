// BR-SEG-39: normalização da categoria, seleção do `classify`, validações do tipo de serviço.
import { describe, expect, it } from "vitest";
import { assertAssignable, assertCanInactivate, assertKnownTypes, normalizeCategory, parseClassifyRequest, parseServiceKindInput, parseServiceKindPatch, selectServicesToClassify } from "./service-kind.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

describe("serviço e tipo (BR-SEG-39)", () => {
  it.each([["  Próteses Dentárias ", "proteses dentarias"], ["EXAMES", "exames"], [null, ""], ["", ""], ["  ", ""]])("normalizeCategory(%j) = %j", (input, expected) => {
    expect(normalizeCategory(input)).toBe(expected);
  });

  const services = [
    { id: "1", category: "Consultas", serviceKindId: null },
    { id: "2", category: " CONSULTAS", serviceKindId: "k" },
    { id: "3", category: null, serviceKindId: null },
    { id: "4", category: "", serviceKindId: "k" },
    { id: "5", category: "Outra", serviceKindId: null },
  ];
  it("selectServicesToClassify: categoria normalizada; onlyUnclassified não sobrescreve; null = sem categoria", () => {
    const req = { category: "consultás", serviceKindId: "x", onlyUnclassified: true };
    expect(selectServicesToClassify(services, { ...req, category: "consultas" })).toEqual(["1"]);
    expect(selectServicesToClassify(services, { ...req, category: "consultas", onlyUnclassified: false })).toEqual(["1", "2"]);
    expect(selectServicesToClassify(services, { ...req, category: null, onlyUnclassified: false })).toEqual(["3", "4"]);
    expect(selectServicesToClassify(services, { ...req, category: "nada" })).toEqual([]);
  });

  it("parseClassifyRequest: omissão onlyUnclassified=true; serviceKindId uuid obrigatório", () => {
    expect(parseClassifyRequest({ serviceKindId: "11111111-1111-4111-8111-111111111111" })).toEqual({ category: null, serviceKindId: "11111111-1111-4111-8111-111111111111", onlyUnclassified: true });
    expect(code(() => parseClassifyRequest({ category: "x" }))).toBe("VALIDATION_ERROR");
    expect(code(() => parseClassifyRequest({ category: "x".repeat(81), serviceKindId: "11111111-1111-4111-8111-111111111111" }))).toBe("VALIDATION_ERROR");
  });

  it("parse do tipo: campos obrigatórios e códigos de catálogo; patch sem code", () => {
    expect(parseServiceKindInput({ code: " C1 ", name: "N", guideType: "SERVICES", expenseType: "DENTAL" })).toEqual({ code: "C1", name: "N", guideType: "SERVICES", expenseType: "DENTAL" });
    expect(code(() => parseServiceKindInput({ code: "C1", name: "N", guideType: "services", expenseType: "DENTAL" }))).toBe("VALIDATION_ERROR");
    expect(parseServiceKindPatch({ status: "INACTIVE", code: "NOVO" })).toEqual({ status: "INACTIVE" });
    expect(code(() => parseServiceKindPatch({ status: "X" }))).toBe("VALIDATION_ERROR");
  });

  it("catálogos, inativação e atribuição", () => {
    const catalog = { guideTypes: [{ code: "SERVICES" }], expenseTypes: [{ code: "DENTAL", legacyCode: "E" }] };
    expect(code(() => { assertKnownTypes(catalog, { guideType: "SERVICES", expenseType: "DENTAL" }); })).toBeUndefined();
    expect(code(() => { assertKnownTypes(catalog, { guideType: "NOPE" }); })).toBe("VALIDATION_ERROR");
    expect(code(() => { assertCanInactivate(0); })).toBeUndefined();
    expect(code(() => { assertCanInactivate(2); })).toBe("CONFLICT");
    expect(code(() => { assertAssignable({ status: "ACTIVE" }, "serviceKindId"); })).toBeUndefined();
    expect(code(() => { assertAssignable({ status: "INACTIVE" }, "serviceKindId"); })).toBe("VALIDATION_ERROR");
    expect(code(() => { assertAssignable(null, "serviceKindId"); })).toBe("VALIDATION_ERROR");
  });
});
