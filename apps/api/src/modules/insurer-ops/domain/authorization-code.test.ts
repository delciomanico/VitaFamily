// BR-SEG-05: código de autorização com ≥ 128 bits de entropia, formato legível, sem colisões em amostra grande.
import { describe, expect, it } from "vitest";
import { generateAuthorizationCode } from "./authorization-code.js";

describe("generateAuthorizationCode", () => {
  it("7 grupos de 4 caracteres de um alfabeto de 31 símbolos (≥ 128 bits)", () => {
    const code = generateAuthorizationCode();
    expect(code).toMatch(/^([2-9A-HJKMNP-Z]{4}-){6}[2-9A-HJKMNP-Z]{4}$/);
    expect(28 * Math.log2(31)).toBeGreaterThan(128);
  });

  it("não se repete (10 000 amostras)", () => {
    expect(new Set(Array.from({ length: 10_000 }, generateAuthorizationCode)).size).toBe(10_000);
  });
});
