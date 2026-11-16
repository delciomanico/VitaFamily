// Testes unitários do access token JWT do portal do profissional (BR-MKT-13/29, authentication.md §5). Relógio fixo; sem I/O.
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  PROFESSIONAL_JWT_AUDIENCE,
  parseProfessionalSigningKeys,
  signProfessionalAccessToken,
  verifyProfessionalAccessToken,
  type ProfessionalSigningKey,
} from "./jwt.js";

const NOW = new Date("2026-11-16T10:00:00.000Z");
const TTL_SECONDS = 900;
const SECRET = "segredo-de-teste-do-portal-profissional-32+";
const KEY: ProfessionalSigningKey = { kid: "k1", secret: new TextEncoder().encode(SECRET) };
const OTHER_KEY: ProfessionalSigningKey = { kid: "k2", secret: new TextEncoder().encode("outro-segredo-de-teste-com-32-chars!") };
const SUBJECT = { professionalAccountId: "acc-1", professionalId: "pro-1", sessionId: "sess-1" };

const secretBytes = new TextEncoder().encode(SECRET);

/** Apanha a rejeição de `promise` (falha o teste se resolver). */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("esperava-se uma rejeição");
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("signProfessionalAccessToken e verifyProfessionalAccessToken", () => {
  it("round-trip devolve professionalAccountId, professionalId e sessionId", async () => {
    const { token, expiresIn } = await signProfessionalAccessToken({ subject: SUBJECT, now: NOW, ttlSeconds: TTL_SECONDS, signingKeys: [KEY] });
    expect(expiresIn).toBe(TTL_SECONDS);
    await expect(verifyProfessionalAccessToken(token, [KEY], NOW)).resolves.toEqual(SUBJECT);
  });

  it("valida com a chave secundária quando o kid corresponde", async () => {
    const { token } = await signProfessionalAccessToken({ subject: SUBJECT, now: NOW, ttlSeconds: TTL_SECONDS, signingKeys: [OTHER_KEY, KEY] });
    await expect(verifyProfessionalAccessToken(token, [KEY, OTHER_KEY], NOW)).resolves.toEqual(SUBJECT);
  });

  it("assina sempre com a primeira chave da lista", async () => {
    const { token } = await signProfessionalAccessToken({ subject: SUBJECT, now: NOW, ttlSeconds: TTL_SECONDS, signingKeys: [KEY, OTHER_KEY] });
    const header = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    expect(header).toMatchObject({ alg: "HS256", kid: "k1" });
  });

  it("token expirado devolve TOKEN_EXPIRED", async () => {
    const { token } = await signProfessionalAccessToken({ subject: SUBJECT, now: NOW, ttlSeconds: TTL_SECONDS, signingKeys: [KEY] });
    const later = new Date(NOW.getTime() + (TTL_SECONDS + 1) * 1000);
    await expect(verifyProfessionalAccessToken(token, [KEY], later)).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("chave desconhecida (kid não listado) devolve UNAUTHENTICATED", async () => {
    const { token } = await signProfessionalAccessToken({ subject: SUBJECT, now: NOW, ttlSeconds: TTL_SECONDS, signingKeys: [OTHER_KEY] });
    await expect(verifyProfessionalAccessToken(token, [KEY], NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("token sem aud 'professional-portal' devolve UNAUTHENTICATED", async () => {
    const token = await new SignJWT({ professionalAccountId: "acc-1", professionalId: "pro-1", sid: "sess-1" })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + TTL_SECONDS)
      .sign(secretBytes);
    await expect(verifyProfessionalAccessToken(token, [KEY], NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("token com aud de outro portal devolve UNAUTHENTICATED", async () => {
    const token = await new SignJWT({ professionalAccountId: "acc-1", professionalId: "pro-1", sid: "sess-1" })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setAudience("outro-portal")
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + TTL_SECONDS)
      .sign(secretBytes);
    await expect(verifyProfessionalAccessToken(token, [KEY], NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("token com claims de User (sub + sid) devolve UNAUTHENTICATED", async () => {
    const token = await new SignJWT({ sid: "sess-1" })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setSubject("user-1")
      .setAudience(PROFESSIONAL_JWT_AUDIENCE)
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + TTL_SECONDS)
      .sign(secretBytes);
    await expect(verifyProfessionalAccessToken(token, [KEY], NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("token com claims de clínica (cid/csid) devolve UNAUTHENTICATED", async () => {
    const token = await new SignJWT({ cid: "clinic-1", csid: "sess-1" })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setAudience(PROFESSIONAL_JWT_AUDIENCE)
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + TTL_SECONDS)
      .sign(secretBytes);
    await expect(verifyProfessionalAccessToken(token, [KEY], NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("token com alg HS512 (fora da lista permitida) devolve UNAUTHENTICATED", async () => {
    const token = await new SignJWT({ professionalAccountId: "acc-1", professionalId: "pro-1", sid: "sess-1" })
      .setProtectedHeader({ alg: "HS512", kid: "k1" })
      .setAudience(PROFESSIONAL_JWT_AUDIENCE)
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + TTL_SECONDS)
      .sign(secretBytes);
    await expect(verifyProfessionalAccessToken(token, [KEY], NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("token com alg none (sem assinatura) devolve UNAUTHENTICATED", async () => {
    const payload = {
      professionalAccountId: "acc-1",
      professionalId: "pro-1",
      sid: "sess-1",
      aud: PROFESSIONAL_JWT_AUDIENCE,
      iat: Math.floor(NOW.getTime() / 1000),
      exp: Math.floor(NOW.getTime() / 1000) + TTL_SECONDS,
    };
    const token = `${base64url({ alg: "none", kid: "k1" })}.${base64url(payload)}.`;
    await expect(verifyProfessionalAccessToken(token, [KEY], NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("token com assinatura adulterada devolve UNAUTHENTICATED", async () => {
    const { token } = await signProfessionalAccessToken({ subject: SUBJECT, now: NOW, ttlSeconds: TTL_SECONDS, signingKeys: [KEY] });
    const [header, payload, signature] = token.split(".");
    const tampered = `${header ?? ""}.${payload ?? ""}.${signature === undefined ? "" : signature.slice(0, -2) + "AA"}`;
    const error = await captureRejection(verifyProfessionalAccessToken(tampered, [KEY], NOW));
    expect(error).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("parseProfessionalSigningKeys", () => {
  it("rejeita JSON inválido", () => {
    expect(() => parseProfessionalSigningKeys("{isto-nao-e-json")).toThrow(/JSON inválido/);
  });

  it("rejeita uma lista vazia", () => {
    expect(() => parseProfessionalSigningKeys("[]")).toThrow(/lista não vazia/);
  });

  it("rejeita um segredo com menos de 32 caracteres", () => {
    expect(() => parseProfessionalSigningKeys(JSON.stringify([{ kid: "k1", secret: "curto-demais" }]))).toThrow(/mín. 32 caracteres/);
  });

  it("rejeita um kid vazio", () => {
    expect(() => parseProfessionalSigningKeys(JSON.stringify([{ kid: "", secret: SECRET }]))).toThrow(/kid inválido/);
  });

  it("aceita uma lista válida e devolve kid e segredo em bytes", () => {
    const keys = parseProfessionalSigningKeys(JSON.stringify([{ kid: "k1", secret: SECRET }, { kid: "k2", secret: `${SECRET}-2` }]));
    expect(keys.map((k) => k.kid)).toEqual(["k1", "k2"]);
    expect(keys[0]?.secret).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(keys[0]?.secret)).toBe(SECRET);
  });
});
