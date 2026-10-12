// Raiz do módulo `admin` (ADR-015/conventions.md §1). M9 (plan.md §4): contas — listar, suspender
// e reativar (FR-ADM-01). Só depende de `users` e `audit` (modules.md §3.4: nunca de saúde).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AuditModule } from "../audit/index.js";
import type { UsersModule } from "../users/index.js";
import {
  createAdminListUsersUseCase,
  createAdminReactivateUserUseCase,
  createAdminSuspendUserUseCase,
  type AdminAccountsDeps,
} from "./application/accounts.js";
import { createAdminRouter, type AdminController } from "./interface/router.js";

export interface AdminModuleDeps {
  db: Kysely<Database>;
  users: UsersModule;
  audit: AuditModule;
  clock: Clock;
}

export interface AdminModule {
  router: Router;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createAdminModule(deps: AdminModuleDeps): AdminModule {
  const accountsDeps: AdminAccountsDeps<Kysely<Database>> = {
    users: deps.users,
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };
  const controller: AdminController = {
    adminListUsers: createAdminListUsersUseCase(accountsDeps),
    adminSuspendUser: createAdminSuspendUserUseCase(accountsDeps),
    adminReactivateUser: createAdminReactivateUserUseCase(accountsDeps),
  };
  return { router: createAdminRouter(controller) };
}

export { createCreatePlatformAdminUseCase, type CreatePlatformAdminResult } from "./application/create-platform-admin.js";
