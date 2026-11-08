import { describe, expect, it } from "vitest";
import { parseProfilePatch } from "./clinic-profile.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("parseProfilePatch (BR-CLN-38)", () => {
  it("aceita parcial, apara texto e limpa com null ou vazio", () => {
    expect(parseProfilePatch({ displayName: "  Clínica Sol ", phone: null, address: "" })).toEqual({ displayName: "Clínica Sol", phone: null, address: null });
  });

  it.each([
    [{}, "corpo vazio"],
    [{ name: "X" }, "name é só leitura"],
    [{ currency: "EUR" }, "currency é só leitura"],
    [{ displayName: "x".repeat(121) }, "displayName > 120"],
    [{ address: "x".repeat(201) }, "address > 200"],
    [{ phone: "1".repeat(31) }, "phone > 30"],
    [{ openingHours: "x".repeat(501) }, "openingHours > 500"],
    [{ description: "x".repeat(501) }, "description > 500"],
    [{ email: "sem-arroba" }, "e-mail inválido"],
    [{ email: `${"a".repeat(250)}@b.pt` }, "e-mail > 254"],
    [{ phone: 123 }, "não texto"],
    [[], "array"],
  ])("recusa %j (%s)", (body) => {
    expect(codeOf(() => parseProfilePatch(body))).toBe("VALIDATION_ERROR");
  });

  it("aceita os limites exatos", () => {
    const body = { displayName: "d".repeat(120), address: "a".repeat(200), phone: "1".repeat(30), openingHours: "h".repeat(500), description: "x".repeat(500), email: "a@b.pt" };
    expect(parseProfilePatch(body)).toEqual(body);
  });
});
