// Validações do catálogo (M14 a1, BR-CLN-11/12, TC-CLN-04).
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { assertValidCatalogName, assertValidServiceDuration, assertValidServiceKind, normalizePriceMinor, normalizeProfessionalSpecialty } from "./clinic-catalog.js";

describe("catálogo da clínica (BR-CLN-11/12)", () => {
  it("nome: 1–120 com trim", () => {
    expect(assertValidCatalogName("  Dra. Ana ")).toBe("Dra. Ana");
    expect(assertValidCatalogName("a".repeat(120))).toHaveLength(120);
    for (const bad of ["", "   ", "a".repeat(121), undefined, 3]) expect(() => assertValidCatalogName(bad)).toThrow(ValidationError);
  });

  it("especialidade: opcional, ≤ 80, vazia => null", () => {
    expect(normalizeProfessionalSpecialty(undefined)).toBeNull();
    expect(normalizeProfessionalSpecialty("  ")).toBeNull();
    expect(normalizeProfessionalSpecialty(" Cardiologia ")).toBe("Cardiologia");
    expect(() => normalizeProfessionalSpecialty("a".repeat(81))).toThrow(ValidationError);
  });

  it.each([
    [undefined, null],
    [null, null],
    [0, 0],
    [1_500_000, 1_500_000],
    [100_000_000_000, 100_000_000_000],
  ])("preço %s é aceite", (input, expected) => {
    expect(normalizePriceMinor(input)).toBe(expected);
  });

  it.each([[-1], [1.5], [100_000_000_001], ["10"], [Number.NaN]])("preço %s é rejeitado", (input) => {
    expect(() => normalizePriceMinor(input)).toThrow(ValidationError);
  });

  it.each([[15], [20], [30], [45], [60]])("duração %i é aceite", (minutes) => {
    expect(assertValidServiceDuration(minutes)).toBe(minutes);
  });

  it.each([[25], [0], [90], ["30"], [undefined]])("duração %s é rejeitada", (minutes) => {
    expect(() => assertValidServiceDuration(minutes)).toThrow(ValidationError);
  });

  it("kind obrigatório e válido", () => {
    expect(assertValidServiceKind("EXAM")).toBe("EXAM");
    expect(() => assertValidServiceKind(undefined)).toThrow(ValidationError);
    expect(() => assertValidServiceKind("OTHER")).toThrow(ValidationError);
  });
});
