// Assinatura do `sessionToken` (HMAC-SHA256, sem estado no servidor; schema.md §15). Formato: `base64url(json).base64url(hmac)`. A chave vem de
// `AI_SESSION_SECRET`. Nunca se regista o token.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AiTokenPayload, AiTokenSigner } from "../application/ports.js";

const mac = (secret: string, body: string): Buffer => createHmac("sha256", secret).update(body).digest();

function isPayload(value: unknown): value is AiTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.jti === "string" &&
    typeof v.userId === "string" &&
    typeof v.familyId === "string" &&
    typeof v.memberId === "string" &&
    typeof v.provider === "string" &&
    typeof v.kind === "string" &&
    typeof v.guardrailsVersion === "string" &&
    typeof v.expiresAtMs === "number"
  );
}

export class HmacAiTokenSigner implements AiTokenSigner {
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error("AI_SESSION_SECRET demasiado curto");
  }

  sign(payload: AiTokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${mac(this.secret, body).toString("base64url")}`;
  }

  verify(token: string): AiTokenPayload | null {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra !== undefined) return null;
    const expected = mac(this.secret, body);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      return isPayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
