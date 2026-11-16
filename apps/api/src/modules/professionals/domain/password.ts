// Hashing e política de palavra-passe do profissional (authentication.md §1/§5: argon2id 64 MiB/3/1, 12–128, lista de comuns).
// Duplicado de `auth` (identidade separada, BR-MKT-13). `argon2` é computação pura (conventions.md §3.9).
import argon2 from "argon2";
import { DomainError, type DomainErrorOptions } from "../../../platform/errors/index.js";
import { COMMON_PASSWORDS } from "./common-passwords.js";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export class ProfessionalPasswordWeakError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("PASSWORD_WEAK", { detail: "Palavra-passe fraca.", ...options });
    this.name = "ProfessionalPasswordWeakError";
  }
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new ProfessionalPasswordWeakError({ detail: `A palavra-passe deve ter entre ${String(PASSWORD_MIN_LENGTH)} e ${String(PASSWORD_MAX_LENGTH)} caracteres.` });
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new ProfessionalPasswordWeakError({ detail: "Palavra-passe demasiado comum." });
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/** Nunca lança por palavra-passe incorreta — devolve `false` (inclui hashes malformados). */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/**
 * Verificação «de enganar» quando a conta não existe: gasta o mesmo tempo de argon2 para que o tempo de resposta não revele se o
 * e-mail está registado (anti-enumeração por temporização).
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalisation");
  await verifyPassword(await dummyHash, password);
}
