// Testes unitários da validação do catálogo de especialidades (TC-MKT-19, BR-MKT-02/22). Sem I/O.
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { validateSpecialtyInput, validateSpecialtyPatch } from "./specialty.js";

/** Apanha o erro lançado por `fn` (falha o teste se não lançar). */
function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("esperava-se um erro");
}

/** Espera `VALIDATION_ERROR` com o campo indicado. */
function expectInvalidField(fn: () => unknown, field: string): void {
  const error = captureError(fn);
  expect(error).toBeInstanceOf(ValidationError);
  expect(error).toMatchObject({ code: "VALIDATION_ERROR", fields: [{ field }] });
}

describe("validateSpecialtyInput: nome (BR-MKT-22)", () => {
  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["1 carácter", "A"],
    ["1 carácter depois de aparar", "  A  "],
    ["81 caracteres", "a".repeat(81)],
    ["81 caracteres depois de aparar", ` ${"a".repeat(81)} `],
    ["não texto", 42],
    ["nulo", null],
  ])("recusa nome %s", (_label, name) => {
    expectInvalidField(() => validateSpecialtyInput({ name, category: "HEALTH" }), "name");
  });

  it.each([
    ["2 caracteres", "Ab"],
    ["80 caracteres", "a".repeat(80)],
    ["aparado", "  Nutrição  "],
  ])("aceita nome %s e devolve-o aparado", (_label, name) => {
    expect(validateSpecialtyInput({ name, category: "WELLNESS" }).name).toBe(name.trim());
  });

  it("mede o tamanho em caracteres (pontos de código), como char_length", () => {
    expect(validateSpecialtyInput({ name: "😀😀", category: "HEALTH" }).name).toBe("😀😀");
  });
});

describe("validateSpecialtyInput: categoria (BR-MKT-02)", () => {
  it.each([
    ["minúscula", "health"],
    ["desconhecida", "OTHER"],
    ["vazia", ""],
    ["nula", null],
  ])("recusa categoria %s", (_label, category) => {
    expectInvalidField(() => validateSpecialtyInput({ name: "Nutrição", category }), "category");
  });

  it.each(["HEALTH", "WELLNESS"])("aceita categoria %s", (category) => {
    expect(validateSpecialtyInput({ name: "Nutrição", category })).toEqual({ name: "Nutrição", category });
  });
});

describe("validateSpecialtyPatch", () => {
  it("recusa um patch vazio", () => {
    expectInvalidField(() => validateSpecialtyPatch({}), "body");
  });

  it.each([
    ["nome curto", { name: "A" }, "name"],
    ["categoria inválida", { category: "X" }, "category"],
    ["active não booleano", { active: "sim" }, "active"],
  ])("recusa %s", (_label, patch, field) => {
    expectInvalidField(() => validateSpecialtyPatch(patch), field);
  });

  it.each([
    [{ name: "  Yoga  " }, { name: "Yoga" }],
    [{ category: "WELLNESS" }, { category: "WELLNESS" }],
    [{ active: false }, { active: false }],
    [{ name: "Yoga", category: "WELLNESS", active: true }, { name: "Yoga", category: "WELLNESS", active: true }],
  ])("aceita o patch %j", (patch, expected) => {
    expect(validateSpecialtyPatch(patch)).toEqual(expected);
  });
});
