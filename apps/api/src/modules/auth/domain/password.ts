// Hashing e política de palavra-passe (authentication.md §1, ADR-007). `argon2` é computação pura
// (bindings nativos, sem rede/disco/fila) — não está na lista de bibliotecas de I/O banidas em
// domain/application (conventions.md §3.9, tests/architecture-rules.ts).
import argon2 from "argon2";
import { isCommonPassword } from "./common-passwords.js";
import { PasswordWeakError } from "./errors.js";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** argon2id, memória 64 MiB, 3 iterações, paralelismo 1 (authentication.md §1). */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

/** Lança `PASSWORD_WEAK` se `password` não cumprir a política; não valida formato do e-mail. */
export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordWeakError({
      detail: `A palavra-passe deve ter entre ${String(PASSWORD_MIN_LENGTH)} e ${String(PASSWORD_MAX_LENGTH)} caracteres.`,
    });
  }
  if (isCommonPassword(password)) {
    throw new PasswordWeakError({ detail: "Palavra-passe demasiado comum." });
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/** Nunca lança por password incorreta — devolve `false` (inclui hashes malformados). */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
