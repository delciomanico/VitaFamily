import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashOpaqueToken } from "./token.js";

describe("generateOpaqueToken", () => {
  it("gera 256 bits (32 bytes) codificados em base64url, sem repetir", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
  });
});

describe("hashOpaqueToken", () => {
  it("é determinístico e nunca devolve o token em claro", () => {
    const token = generateOpaqueToken();
    const hashA = hashOpaqueToken(token);
    const hashB = hashOpaqueToken(token);
    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(token);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });
});
