// Raiz do módulo `users` (ADR-015/conventions.md §1): única API pública importável por outros
// módulos (`auth`) e composition root (`main/api.ts`).
import type { Kysely } from "kysely";
import type { Router } from "express";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AuditModule } from "../audit/index.js";
import { createAcceptTermsUseCase } from "./application/accept-terms.js";
import { createDeleteMeUseCase } from "./application/delete-me.js";
import { createGetMeUseCase } from "./application/get-me.js";
import type { NewUserRecord, UsersDeps } from "./application/ports.js";
import { createRawOperations } from "./application/raw-operations.js";
import { createUpdateMeUseCase } from "./application/update-me.js";
import type { User } from "./domain/user.js";
import { KyselyUsersRepository } from "./infrastructure/repo.js";
import { createUsersRouter } from "./interface/router.js";

export type { User, UserStatus, PlatformRole } from "./domain/user.js";
export type { UserView } from "./application/get-me.js";
export type { NewUserRecord, ProfileChanges } from "./application/ports.js";
export type { UpdateMeInput } from "./application/update-me.js";

export interface UsersModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  /** `TERMS_VERSION` (config), lida uma única vez na composition root (B6). */
  currentTermsVersion: string;
}

export interface UsersModule {
  router: Router;
  // Operações cruas para o módulo `auth` chamar (CLAUDE.md M1 §3).
  createAccount: (trx: Kysely<Database>, record: NewUserRecord) => Promise<User>;
  byEmail: (trx: Kysely<Database>, email: string) => Promise<User | null>;
  byId: (trx: Kysely<Database>, id: string) => Promise<User | null>;
  setEmailVerified: (trx: Kysely<Database>, id: string, verifiedAt: Date) => Promise<User>;
  setPasswordHash: (trx: Kysely<Database>, id: string, passwordHash: string) => Promise<void>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createUsersModule(deps: UsersModuleDeps): UsersModule {
  const usersRepo = new KyselyUsersRepository();
  const usersDeps: UsersDeps<Kysely<Database>> = {
    usersRepo,
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    currentTermsVersion: deps.currentTermsVersion,
  };

  const rawOperations = createRawOperations(usersRepo);
  const router = createUsersRouter({
    getMe: createGetMeUseCase(usersDeps),
    updateMe: createUpdateMeUseCase(usersDeps),
    acceptTerms: createAcceptTermsUseCase(usersDeps),
    deleteMe: createDeleteMeUseCase(),
  });

  return {
    router,
    createAccount: rawOperations.createAccount,
    byEmail: rawOperations.byEmail,
    byId: rawOperations.byId,
    setEmailVerified: rawOperations.setEmailVerified,
    setPasswordHash: rawOperations.setPasswordHash,
  };
}
