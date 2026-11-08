// AC-CLN-13 / TC-CLN-08: validação, normalização e pesquisa do registo de pacientes (BR-CLN-17/22). Regras puras.
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import {
  buildSearchTerms,
  decodeCursor,
  encodeCursor,
  normalizeSearchText,
  parsePatientInput,
  parsePatientPatch,
  parseSearchQuery,
  patientMatches,
  phoneDigits,
} from "./clinic-patient.js";

const TODAY = "2026-11-08";

describe("normalizeSearchText / phoneDigits", () => {
  it.each([
    ["  João   da Conceição ", "joao da conceicao"],
    ["ÁGATA", "agata"],
    ["Zoë", "zoe"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected);
  });

  it("phoneDigits só mantém dígitos", () => {
    expect(phoneDigits("+351 912-345 (678)")).toBe("351912345678");
  });
});

describe("parsePatientInput", () => {
  it("aceita só o nome; opcionais ficam nulos; e-mail em minúsculas; texto aparado", () => {
    expect(parsePatientInput({ name: "  Ana Silva " }, TODAY)).toEqual({ name: "Ana Silva", phone: null, email: null, birthDate: null, notes: null });
    expect(parsePatientInput({ name: "A", email: "ANA@Example.PT", phone: "+351 912 345 678", birthDate: "1990-02-03", notes: " nota " }, TODAY)).toEqual({
      name: "A",
      email: "ana@example.pt",
      phone: "+351 912 345 678",
      birthDate: "1990-02-03",
      notes: "nota",
    });
  });

  it.each([
    ["nome vazio", { name: "   " }, "name"],
    ["nome > 120", { name: "x".repeat(121) }, "name"],
    ["telefone inválido", { name: "A", phone: "abc" }, "phone"],
    ["telefone > 30", { name: "A", phone: "1".repeat(31) }, "phone"],
    ["e-mail inválido", { name: "A", email: "sem-arroba" }, "email"],
    ["data futura", { name: "A", birthDate: "2026-11-09" }, "birthDate"],
    ["data inexistente", { name: "A", birthDate: "2026-02-30" }, "birthDate"],
    ["data mal formada", { name: "A", birthDate: "03/02/1990" }, "birthDate"],
    ["notas > 2000", { name: "A", notes: "n".repeat(2001) }, "notes"],
  ])("%s => VALIDATION_ERROR no campo %s", (_label, input, field) => {
    try {
      parsePatientInput(input, TODAY);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fields?.map((f) => f.field)).toContain(field);
    }
  });

  it("a data de hoje é válida (não futura)", () => {
    expect(parsePatientInput({ name: "A", birthDate: TODAY }, TODAY).birthDate).toBe(TODAY);
  });
});

describe("parsePatientPatch", () => {
  it("null limpa opcionais; só devolve os campos presentes", () => {
    expect(parsePatientPatch({ phone: null, notes: "x" }, TODAY)).toEqual({ phone: null, notes: "x" });
  });
  it("name não aceita null; patch vazio é inválido", () => {
    expect(() => parsePatientPatch({ name: null }, TODAY)).toThrow(ValidationError);
    expect(() => parsePatientPatch({}, TODAY)).toThrow(ValidationError);
  });
});

describe("pesquisa (BR-CLN-22)", () => {
  it.each([["a"], ["x".repeat(101)], [undefined]])("q %j é inválido quando obrigatório", (q) => {
    expect(() => parseSearchQuery(q, true)).toThrow(ValidationError);
  });
  it("q opcional ausente é undefined; q válido é aparado", () => {
    expect(parseSearchQuery(undefined, false)).toBeUndefined();
    expect(parseSearchQuery("  ab ", true)).toBe("ab");
  });

  const patient = { name: "João Conceição", email: "joao@clinica.pt", phone: "+351 912 345 678" };
  it.each([
    ["joao", true],
    ["CONCEICAO", true],
    ["ão c", true],
    ["clinica.pt", true],
    ["912 345", true],
    ["+351", true],
    ["91", false],
    ["%", false],
    ["_", false],
  ])("q=%j => %j (nome sem acentos/maiúsculas, e-mail contém, telefone ≥3 dígitos)", (q, expected) => {
    expect(patientMatches(patient, buildSearchTerms(q))).toBe(expected);
  });

  it("telefone só conta se q parece um telefone (letras desligam a pesquisa por dígitos)", () => {
    expect(buildSearchTerms("ana 912").phoneDigits).toBeNull();
    expect(buildSearchTerms("912 345").phoneDigits).toBe("912345");
  });
});

describe("cursor", () => {
  it("round-trip e rejeita lixo", () => {
    const cursor = { n: "ana", i: "11111111-1111-4111-8111-111111111111" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(() => decodeCursor("%%%")).toThrow(ValidationError);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ n: "x", i: "nao-uuid" })).toString("base64url"))).toThrow(ValidationError);
  });
});
