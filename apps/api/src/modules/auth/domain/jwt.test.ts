import { describe, expect, it } from "vitest";
import { DomainError, UnauthenticatedError } from "../../../platform/errors/index.js";
import { parseSigningKeys, signAccessToken, verifyAccessToken } from "./jwt.js";

const KEYS_JSON = JSON.stringify([
  { kid: "2026-01", secret: "a".repeat(32) },
  { kid: "2025-12", secret: "b".repeat(32) },
]);

describe("parseSigningKeys", () => {
  it("lê a lista JSON { kid, secret }", () => {
    const keys = parseSigningKeys(KEYS_JSON);
    expect(keys).toHaveLength(2);
    expect(keys[0]?.kid).toBe("2026-01");
  });

  it.each(["not-json", "[]", JSON.stringify([{ kid: "x" }]), JSON.stringify([{ kid: "x", secret: "short" }])])(
    "rejeita formato inválido: %s",
    (raw) => {
      expect(() => parseSigningKeys(raw)).toThrow();
    },
  );
});

describe("signAccessToken / verifyAccessToken", () => {
  it("assina com a chave atual e verifica com sucesso", async () => {
    const signingKeys = parseSigningKeys(KEYS_JSON);
    const now = new Date("2026-10-08T10:00:00Z");
    const { token, expiresIn } = await signAccessToken({
      subject: { userId: "u1", sessionId: "s1" },
      now,
      ttlSeconds: 900,
      signingKeys,
    });
    expect(expiresIn).toBe(900);

    const subject = await verifyAccessToken(token, signingKeys, now);
    expect(subject).toEqual({ userId: "u1", sessionId: "s1" });
  });

  it("verifica tokens assinados com uma chave antiga (rotação, kid ainda na lista)", async () => {
    const allKeys = parseSigningKeys(KEYS_JSON);
    const secondKey = allKeys[1];
    if (!secondKey) {
      throw new Error("fixture inválida");
    }
    const oldKeyOnly = [secondKey];
    const now = new Date("2026-10-08T10:00:00Z");
    const { token } = await signAccessToken({
      subject: { userId: "u2", sessionId: "s2" },
      now,
      ttlSeconds: 900,
      signingKeys: oldKeyOnly,
    });

    await expect(verifyAccessToken(token, allKeys, now)).resolves.toEqual({
      userId: "u2",
      sessionId: "s2",
    });
  });

  it("lança TOKEN_EXPIRED quando o prazo passou", async () => {
    const signingKeys = parseSigningKeys(KEYS_JSON);
    const now = new Date("2026-10-08T10:00:00Z");
    const { token } = await signAccessToken({
      subject: { userId: "u1", sessionId: "s1" },
      now,
      ttlSeconds: 900,
      signingKeys,
    });

    const afterExpiry = new Date(now.getTime() + 901_000);
    await expect(verifyAccessToken(token, signingKeys, afterExpiry)).rejects.toSatisfy(
      (err: unknown) => err instanceof DomainError && err.code === "TOKEN_EXPIRED",
    );
  });

  it("lança UNAUTHENTICATED para um kid desconhecido", async () => {
    const signingKeys = parseSigningKeys(KEYS_JSON);
    const now = new Date("2026-10-08T10:00:00Z");
    const unknownKeySigned = await signAccessToken({
      subject: { userId: "u1", sessionId: "s1" },
      now,
      ttlSeconds: 900,
      signingKeys: [{ kid: "outra", secret: new TextEncoder().encode("c".repeat(32)) }],
    });

    await expect(
      verifyAccessToken(unknownKeySigned.token, signingKeys, now),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
