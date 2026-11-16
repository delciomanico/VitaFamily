// Tokens do portal do profissional (BR-MKT-13/14): refresh opaco de 256 bits guardado hasheado; código OTP de 6 dígitos
// (verificação de e-mail 24 h; recuperação 1 h), sempre procurado no âmbito da conta do e-mail. `node:crypto` não é I/O banido.
import { createHash, randomBytes, randomInt } from "node:crypto";

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
