// Operações cruas expostas pela raiz do módulo para o `auth` chamar (nenhuma regra de negócio
// além da normalização de entrada) — ver CLAUDE.md M1 §3: `createAccount`, `byEmail`, `byId`,
// `setEmailVerified`, `setPasswordHash`.
import { normalizeEmail } from "../domain/user.js";
import type { User } from "../domain/user.js";
import type { NewUserRecord, UsersRepository } from "./ports.js";

export function createRawOperations<Trx>(usersRepo: UsersRepository<Trx>): {
  createAccount: (trx: Trx, record: NewUserRecord) => Promise<User>;
  byEmail: (trx: Trx, email: string) => Promise<User | null>;
  byId: (trx: Trx, id: string) => Promise<User | null>;
  setEmailVerified: (trx: Trx, id: string, verifiedAt: Date) => Promise<User>;
  setPasswordHash: (trx: Trx, id: string, passwordHash: string) => Promise<void>;
} {
  return {
    createAccount: (trx, record) =>
      usersRepo.insert(trx, { ...record, email: normalizeEmail(record.email) }),
    byEmail: (trx, email) => usersRepo.findByEmail(trx, normalizeEmail(email)),
    byId: (trx, id) => usersRepo.findById(trx, id),
    setEmailVerified: (trx, id, verifiedAt) => usersRepo.updateEmailVerified(trx, id, verifiedAt),
    setPasswordHash: (trx, id, passwordHash) => usersRepo.updatePasswordHash(trx, id, passwordHash),
  };
}
