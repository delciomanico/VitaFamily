// Tokens opacos do convite (R3/BR-MEM-12) — cópia pequena e intencional de
// `auth/domain/token.ts` (mesma justificação de `registration-rules.ts`: `node:crypto` é builtin,
// não é biblioteca de I/O, conventions.md §3.9; duplicar é mais barato que acoplar os módulos).
import { createHash, randomBytes } from "node:crypto";

/** 256 bits aleatórios, codificados em base64url (seguro em e-mails/URLs). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 em hexadecimal — nunca se guarda o token em claro. */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
