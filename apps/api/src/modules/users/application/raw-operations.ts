// Operações cruas expostas pela raiz do módulo para o `auth` chamar (nenhuma regra de negócio
// além da normalização de entrada) — ver CLAUDE.md M1 §3: `createAccount`, `byEmail`, `byId`,
// `setEmailVerified`, `setPasswordHash`.
import { normalizeEmail } from "../domain/user.js";
import type { User } from "../domain/user.js";
import type { AccountListFilter, AccountPage, NewUserRecord, Suspension, UsersRepository } from "./ports.js";

export function createRawOperations<Trx>(usersRepo: UsersRepository<Trx>): {
  createAccount: (trx: Trx, record: NewUserRecord) => Promise<User>;
  byEmail: (trx: Trx, email: string) => Promise<User | null>;
  byId: (trx: Trx, id: string) => Promise<User | null>;
  setEmailVerified: (trx: Trx, id: string, verifiedAt: Date) => Promise<User>;
  setPasswordHash: (trx: Trx, id: string, passwordHash: string) => Promise<void>;
  listAccounts: (trx: Trx, filter: AccountListFilter) => Promise<AccountPage>;
  setSuspension: (trx: Trx, id: string, suspension: Suspension | null) => Promise<User>;
  setPlatformRole: (trx: Trx, id: string, role: User["platformRole"]) => Promise<User>;
  deleteAccount: (trx: Trx, id: string) => Promise<void>;
} {
  return {
    createAccount: (trx, record) =>
      usersRepo.insert(trx, { ...record, email: normalizeEmail(record.email) }),
    byEmail: (trx, email) => usersRepo.findByEmail(trx, normalizeEmail(email)),
    byId: (trx, id) => usersRepo.findById(trx, id),
    setEmailVerified: (trx, id, verifiedAt) => usersRepo.updateEmailVerified(trx, id, verifiedAt),
    setPasswordHash: (trx, id, passwordHash) => usersRepo.updatePasswordHash(trx, id, passwordHash),
    listAccounts: (trx, filter) => usersRepo.listAll(trx, filter),
    setSuspension: (trx, id, suspension) => usersRepo.setSuspension(trx, id, suspension),
    setPlatformRole: (trx, id, role) => usersRepo.setPlatformRole(trx, id, role),
    deleteAccount: (trx, id) => usersRepo.deleteById(trx, id),
  };
}
