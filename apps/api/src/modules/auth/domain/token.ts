// Tokens opacos (refresh token de sessão; tokens de verificação/recuperação) — authentication.md
// §1: "Opaco, 256 bits aleatórios ... guardado hasheado". `node:crypto` é builtin, não é biblioteca
// de I/O (conventions.md §3.9).
import { createHash, randomBytes } from "node:crypto";

/** 256 bits aleatórios, codificados em base64url (sem padding, seguro em cookies/URLs). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 em hexadecimal — nunca se guarda o token em claro (authentication.md §1). */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
