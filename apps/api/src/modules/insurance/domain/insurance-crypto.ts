// Palavra-passe e refresh token do portal da seguradora (ADR-021/ADR-020: duplicado de `clinics`,
// identidade deliberadamente separada — nunca importar `auth`/`clinics`). `argon2` e `node:crypto`
// são computação pura, permitidos no domain (conventions.md §3.2/§3.9).
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";

const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export async function hashInsurancePassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/** Nunca lança por password incorreta — devolve `false` (inclui hashes malformados). */
export async function verifyInsurancePassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Palavra-passe inicial/reposta: gerada pelo servidor (144 bits) e só enviada por e-mail, nunca na resposta HTTP. */
export function generateInitialInsurancePassword(): string {
  return randomBytes(18).toString("base64url");
}

export function generateInsuranceOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInsuranceOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
