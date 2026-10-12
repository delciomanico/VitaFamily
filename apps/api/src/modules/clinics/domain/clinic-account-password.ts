// Hashing de palavra-passe do portal da clínica (ADR-020: duplicado de `auth/domain/password.ts`
// — mesmos parâmetros argon2id, identidade deliberadamente separada, CLAUDE.md). `argon2` é
// computação pura (bindings nativos, sem I/O) — permitido em domain/application (conventions.md
// §3.9).
import argon2 from "argon2";
import { randomBytes } from "node:crypto";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashClinicPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/** Nunca lança por password incorreta — devolve `false` (inclui hashes malformados). */
export async function verifyClinicPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Palavra-passe inicial/reposta (endpoints.md `adminCreateOrResetClinicRootAccount`, D18): gerada
 * pelo servidor (nunca escolhida pelo Platform Admin) e enviada só por e-mail — nunca aparece no
 * corpo da resposta HTTP. 24 caracteres base64url (144 bits de entropia) chegam de sobra à política
 * de `auth` (mín. 12) sem precisar de a replicar aqui (não há escolha humana a validar).
 */
export function generateInitialClinicPassword(): string {
  return randomBytes(18).toString("base64url");
}
