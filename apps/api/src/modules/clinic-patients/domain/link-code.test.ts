// AC-CLN-15 / TC-CLN-10: formato, alfabeto e HMAC do código de ligação (BR-CLN-20).
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { formatLinkCode, generateLinkCode, hashLinkCode, LINK_CODE_ALPHABET, normalizeLinkCode } from "./link-code.js";

describe("generateLinkCode", () => {
  it("8 caracteres do alfabeto sem 0 O 1 I L", () => {
    expect(LINK_CODE_ALPHABET).not.toMatch(/[01OIL]/);
    for (let i = 0; i < 500; i++) {
      expect(generateLinkCode()).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    }
  });
  it("não repete (500 códigos distintos)", () => {
    expect(new Set(Array.from({ length: 500 }, generateLinkCode)).size).toBe(500);
  });
  it("o código gerado cumpre o pattern do contrato (openapi ClinicLinkCode)", () => {
    expect(generateLinkCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
});

describe("normalizeLinkCode", () => {
  it.each([
    ["abcd-efgh", "ABCDEFGH"],
    [" ABCD EFGH ", "ABCDEFGH"],
    ["abcdefgh", "ABCDEFGH"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeLinkCode(input)).toBe(expected);
  });
  it.each(["abc", "ABCDEFGHJ", "ABCD-EFG0", "ABCD-EFGO", "ABCD-EFG1", "ABCD-EFGI", "ABCD-EFGL", undefined, 12345678])("rejeita %j com VALIDATION_ERROR (sem ecoar o valor)", (input) => {
    try {
      normalizeLinkCode(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(JSON.stringify(error)).not.toContain(String(input));
    }
  });
});

describe("hashLinkCode / formatLinkCode", () => {
  it("HMAC-SHA256 hex determinista, dependente do segredo, nunca o código", () => {
    const a = hashLinkCode("segredo-1-segredo-1", "ABCDEFGH");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(hashLinkCode("segredo-1-segredo-1", "ABCDEFGH"));
    expect(a).not.toBe(hashLinkCode("segredo-2-segredo-2", "ABCDEFGH"));
    expect(a).not.toBe(hashLinkCode("segredo-1-segredo-1", "ABCDEFGJ"));
    expect(a.toUpperCase()).not.toContain("ABCDEFGH");
  });
  it("XXXX-XXXX", () => {
    expect(formatLinkCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });
});
