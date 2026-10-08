// Portas do módulo `users` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou injetadas pela raiz (`audit`, `Clock`). Genéricas em `Trx` para
// que esta camada nunca precise de importar "kysely" (banido em domain/application).
import type { AuditEvent } from "../../audit/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { User } from "../domain/user.js";

export interface NewUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  birthDate: string;
  timezone: string;
  termsAcceptedVersion: string;
  termsAcceptedAt: Date;
  createdAt: Date;
}

export interface ProfileChanges {
  name?: string;
  timezone?: string;
}

export interface UsersRepository<Trx> {
  insert(trx: Trx, record: NewUserRecord): Promise<User>;
  findByEmail(trx: Trx, email: string): Promise<User | null>;
  findById(trx: Trx, id: string): Promise<User | null>;
  updateProfile(trx: Trx, id: string, changes: ProfileChanges): Promise<User>;
  updateTermsAcceptance(trx: Trx, id: string, version: string, acceptedAt: Date): Promise<User>;
  updateEmailVerified(trx: Trx, id: string, verifiedAt: Date): Promise<User>;
  updatePasswordHash(trx: Trx, id: string, passwordHash: string): Promise<void>;
}

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

/** Equivalente a `withTransaction` de `platform/db`, mas opaco em `Trx` (sem importar "kysely"). */
export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface UsersDeps<Trx> {
  usersRepo: UsersRepository<Trx>;
  audit: AuditPort<Trx>;
  /** Ligação não transacional, para leituras que não escrevem (ex.: `getMe`). */
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  /** `TERMS_VERSION` (config) — injetada pela raiz, nunca lida diretamente aqui. */
  currentTermsVersion: string;
}
