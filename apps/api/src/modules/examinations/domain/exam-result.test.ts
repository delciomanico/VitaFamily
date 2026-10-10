import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { assertHasValue, assertValidReferenceRange } from "./exam-result.js";

describe("assertHasValue (BR-EXM-01)", () => {
  it("aceita valor numérico, texto, ou ambos", () => {
    expect(() => {
      assertHasValue(5, undefined);
    }).not.toThrow();
    expect(() => {
      assertHasValue(undefined, "positivo");
    }).not.toThrow();
    expect(() => {
      assertHasValue(5, "positivo");
    }).not.toThrow();
  });

  it("recusa quando nenhum valor é dado", () => {
    expect(() => {
      assertHasValue(undefined, undefined);
    }).toThrow(ValidationError);
  });
});

describe("assertValidReferenceRange (schema.md CHECK)", () => {
  it("aceita min <= max ou qualquer um ausente", () => {
    expect(() => {
      assertValidReferenceRange(1, 5);
    }).not.toThrow();
    expect(() => {
      assertValidReferenceRange(5, 5);
    }).not.toThrow();
    expect(() => {
      assertValidReferenceRange(undefined, 5);
    }).not.toThrow();
    expect(() => {
      assertValidReferenceRange(1, undefined);
    }).not.toThrow();
  });

  it("recusa min > max", () => {
    expect(() => {
      assertValidReferenceRange(10, 1);
    }).toThrow(ValidationError);
  });
});
