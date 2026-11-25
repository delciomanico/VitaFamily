import { describe, expect, it } from "vitest";
import type { AiTokenPayload } from "../application/ports.js";
import { HmacAiTokenSigner } from "./token-signer.js";

const SECRET = "0123456789abcdef0123456789abcdef-test";
const payload: AiTokenPayload = { jti: "j1", userId: "u1", familyId: "f1", memberId: "m1", provider: "CLAUDE", kind: "SUMMARY", guardrailsVersion: "v1", expiresAtMs: 123 };

describe("HmacAiTokenSigner", () => {
  const signer = new HmacAiTokenSigner(SECRET);
  it("assina e verifica (ida e volta)", () => { expect(signer.verify(signer.sign(payload))).toEqual(payload); });
  it("recusa token alterado, assinatura trocada, outra chave e lixo", () => {
    const token = signer.sign(payload);
    const [body, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...payload, userId: "outro" })).toString("base64url");
    expect(signer.verify(`${forged}.${sig}`)).toBeNull();
    expect(signer.verify(`${body}.${sig.slice(1)}x`)).toBeNull();
    expect(new HmacAiTokenSigner("outra-chave-com-mais-de-32-caracteres-0000").verify(token)).toBeNull();
    for (const junk of ["", "x", "a.b.c", "....", `${body}.`]) expect(signer.verify(junk)).toBeNull();
  });
  it("recusa uma chave curta", () => { expect(() => new HmacAiTokenSigner("curta")).toThrow(); });
});
