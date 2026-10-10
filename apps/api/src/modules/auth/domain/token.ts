// Tokens opacos (refresh token de sessão; token de recuperação de palavra-passe) — authentication.md
// §1: "Opaco, 256 bits aleatórios ... guardado hasheado". `node:crypto` é builtin, não é biblioteca
// de I/O (conventions.md §3.9).
import { createHash, randomBytes, randomInt } from "node:crypto";

/** 256 bits aleatórios, codificados em base64url (sem padding, seguro em cookies/URLs). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Código de 6 dígitos para verificação de e-mail (decisão do proprietário, ver apps/web
 * VerifyPage — substitui o link de UC-ACC-01). A procura por este código é sempre colocada em
 * âmbito do utilizador (ver `findValidForUser`), por isso 10^6 valores bastam: não há colisão
 * entre contas diferentes, só entre tentativas da mesma conta, e o token anterior é invalidado
 * a cada reenvio (`invalidateAllForUser`).
 */
export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** SHA-256 em hexadecimal — nunca se guarda o token em claro (authentication.md §1). */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
