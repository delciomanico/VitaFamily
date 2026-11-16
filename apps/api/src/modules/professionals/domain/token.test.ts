// Testes unitários dos tokens do portal do profissional (BR-MKT-13/14). `randomInt` é mockado só para o preenchimento
// com zeros; os restantes testes usam o `node:crypto` real. Sem I/O.
import { randomInt } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateOpaqueToken, generateVerificationCode, hashOpaqueToken } from "./token.js";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

describe("generateVerificationCode", () => {
  beforeEach(() => {
    vi.mocked(randomInt).mockClear();
  });

  it("devolve sempre 6 dígitos (200 amostras reais)", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it.each([
    [0, "000000"],
    [7, "000007"],
    [42, "000042"],
    [999_999, "999999"],
  ])("preenche com zeros à esquerda quando randomInt devolve %i", (value, expected) => {
    vi.mocked(randomInt).mockReturnValueOnce(value);
    expect(generateVerificationCode()).toBe(expected);
  });

  it("pede a randomInt o intervalo [0, 1000000)", () => {
    generateVerificationCode();
    expect(randomInt).toHaveBeenCalledWith(0, 1_000_000);
  });
});

describe("hashOpaqueToken", () => {
  it("devolve o SHA-256 em hexadecimal (64 caracteres) conhecido para 'abc'", () => {
    expect(hashOpaqueToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("é determinista para o mesmo token", () => {
    const token = generateOpaqueToken();
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });

  it("devolve hexadecimal de 64 caracteres", () => {
    expect(hashOpaqueToken(generateOpaqueToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tokens diferentes geram hashes diferentes", () => {
    expect(hashOpaqueToken("token-a")).not.toBe(hashOpaqueToken("token-b"));
  });
});

describe("generateOpaqueToken", () => {
  it("devolve pelo menos 43 caracteres em base64url (256 bits)", () => {
    const token = generateOpaqueToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("gera tokens distintos em 100 chamadas", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(100);
  });
});
