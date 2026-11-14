// Token do QR do cartão (BR-SEG-18: assinado, de validade curta e revogável por `cardVersion`; sem dados clínicos).
// Formato (pressuposto de implementação — a documentação não o fixa): `base64url(JSON{v,i,b,c,e}).base64url(HMAC-SHA256)`.
// `i` = insurerId, `b` = beneficiaryId, `c` = cardVersion, `e` = expiração (segundos Unix). A emissão (S6, `CARD_QR_ISSUE`)
// usa `signCardQrToken`; a clínica só verifica. O segredo é separado por domínio (prefixo) do usado nos códigos de reclamação.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Validade por omissão do QR (conservador: 2 min; a documentação não fixa o valor). */
export const CARD_QR_TTL_SECONDS = 120;

export interface CardQrClaims {
  insurerId: string;
  beneficiaryId: string;
  cardVersion: number;
  /** Segundos Unix. */
  expiresAt: number;
}

const sign = (secret: string, payload: string): Buffer => createHmac("sha256", secret).update(`insurer-card-qr:v1:${payload}`, "utf8").digest();

export function signCardQrToken(secret: string, claims: CardQrClaims): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, i: claims.insurerId, b: claims.beneficiaryId, c: claims.cardVersion, e: claims.expiresAt }), "utf8").toString("base64url");
  return `${payload}.${sign(secret, payload).toString("base64url")}`;
}

/** Devolve as claims se a assinatura e a validade forem boas; qualquer defeito ⇒ `null` (a resposta é a mesma, BR-SEG-18). */
export function verifyCardQrToken(secret: string, token: string, now: Date): CardQrClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  const expected = sign(secret, payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (raw.v !== 1 || typeof raw.i !== "string" || typeof raw.b !== "string" || typeof raw.c !== "number" || typeof raw.e !== "number") return null;
    if (raw.e * 1000 <= now.getTime()) return null;
    return { insurerId: raw.i, beneficiaryId: raw.b, cardVersion: raw.c, expiresAt: raw.e };
  } catch {
    return null;
  }
}
