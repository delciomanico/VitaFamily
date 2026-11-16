// Testes unitários da validação de ofertas (TC-MKT-37, BR-MKT-03/24/31). Sem I/O.
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { MAX_OFFER_NOTE, validateOfferInput, validateOfferPatch } from "./offer.js";

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

const VALID_OFFER = { specialtyId: "spec-1", method: "VIDEO", durationMinutes: 30, priceKz: 15_000 };

describe("validateOfferInput: priceKz (BR-MKT-31)", () => {
  it.each([
    ["fracionário", 10.5],
    ["string 1e3", "1e3"],
    ["string numérica", "15000"],
    ["negativo", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["acima de 100 000 000", 100_000_001],
    ["nulo", null],
  ])("recusa priceKz %s", (_label, priceKz) => {
    expectInvalidField(() => validateOfferInput({ ...VALID_OFFER, priceKz }), "priceKz");
  });

  it.each([0, 1, 15_000, 100_000_000])("aceita priceKz inteiro %s", (priceKz) => {
    expect(validateOfferInput({ ...VALID_OFFER, priceKz }).priceKz).toBe(priceKz);
  });
});

describe("validateOfferInput: duração e método", () => {
  it.each([15, 20, 30, 45, 60])("aceita duração de %s minutos", (durationMinutes) => {
    expect(validateOfferInput({ ...VALID_OFFER, durationMinutes }).durationMinutes).toBe(durationMinutes);
  });

  it.each([10, 25, 90, 0, "30", null])("recusa duração inválida %j", (durationMinutes) => {
    expectInvalidField(() => validateOfferInput({ ...VALID_OFFER, durationMinutes }), "durationMinutes");
  });

  it.each(["IN_PERSON", "VIDEO", "CHAT", "PHONE"])("aceita o método %s", (method) => {
    expect(validateOfferInput({ ...VALID_OFFER, method }).method).toBe(method);
  });

  it.each(["EMAIL", "video", "", null, 1])("recusa o método inválido %j", (method) => {
    expectInvalidField(() => validateOfferInput({ ...VALID_OFFER, method }), "method");
  });

  it("recusa specialtyId vazio", () => {
    expectInvalidField(() => validateOfferInput({ ...VALID_OFFER, specialtyId: "" }), "specialtyId");
  });
});

describe("validateOfferInput: nota (BR-MKT-03)", () => {
  it(`aceita nota com exatamente ${String(MAX_OFFER_NOTE)} caracteres`, () => {
    const note = "n".repeat(MAX_OFFER_NOTE);
    expect(validateOfferInput({ ...VALID_OFFER, note }).note).toBe(note);
  });

  it(`recusa nota com mais de ${String(MAX_OFFER_NOTE)} caracteres`, () => {
    expectInvalidField(() => validateOfferInput({ ...VALID_OFFER, note: "n".repeat(MAX_OFFER_NOTE + 1) }), "note");
  });

  it("nota com 200 caracteres úteis e espaços à volta é aceite e aparada", () => {
    expect(validateOfferInput({ ...VALID_OFFER, note: `  ${"n".repeat(MAX_OFFER_NOTE)}  ` }).note).toBe("n".repeat(MAX_OFFER_NOTE));
  });

  it.each([undefined, null, "", "   "])("nota %j vira null", (note) => {
    expect(validateOfferInput({ ...VALID_OFFER, note }).note).toBeNull();
  });

  it("nota com tipo não textual é recusada", () => {
    expectInvalidField(() => validateOfferInput({ ...VALID_OFFER, note: 42 }), "note");
  });
});

describe("validateOfferPatch (BR-MKT-24)", () => {
  it.each(["specialtyId", "method", "durationMinutes"])("recusa alterar %s (imutável)", (field) => {
    const value = field === "durationMinutes" ? 30 : "x";
    expectInvalidField(() => validateOfferPatch({ [field]: value, priceKz: 1000 }), field);
  });

  it("recusa patch vazio", () => {
    expectInvalidField(() => validateOfferPatch({}), "body");
  });

  it("recusa priceKz fracionário no patch", () => {
    expectInvalidField(() => validateOfferPatch({ priceKz: 10.5 }), "priceKz");
  });

  it("recusa active que não é booleano", () => {
    expectInvalidField(() => validateOfferPatch({ active: "yes" }), "active");
    expectInvalidField(() => validateOfferPatch({ active: 1 }), "active");
  });

  it("aceita active false", () => {
    expect(validateOfferPatch({ active: false })).toEqual({ active: false });
  });

  it("aceita alterar só o preço", () => {
    expect(validateOfferPatch({ priceKz: 2_000 })).toEqual({ priceKz: 2_000 });
  });

  it("nota no patch: null limpa, texto é aparado, longa é recusada", () => {
    expect(validateOfferPatch({ note: null })).toEqual({ note: null });
    expect(validateOfferPatch({ note: "  olá  " })).toEqual({ note: "olá" });
    expectInvalidField(() => validateOfferPatch({ note: "n".repeat(MAX_OFFER_NOTE + 1) }), "note");
  });
});
