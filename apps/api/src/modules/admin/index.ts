// Raiz do módulo `admin` (ADR-015/conventions.md §1). M9 (plan.md §4): contas — listar, suspender
// e reativar (FR-ADM-01). Só depende de `users` e `audit` (modules.md §3.4: nunca de saúde).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AuditModule } from "../audit/index.js";
import type { AuthModule } from "../auth/index.js";
import type { ClinicsModule } from "../clinics/index.js";
import type { UsersModule } from "../users/index.js";
import {
  createAdminGetUserUseCase,
  createAdminListUsersUseCase,
  createAdminReactivateUserUseCase,
  createAdminResetUserAccessUseCase,
  createAdminSuspendUserUseCase,
  type AdminAccountsDeps,
  type AdminFamiliesPort,
} from "./application/accounts.js";
import { createAdminRouter, type AdminController } from "./interface/router.js";

export interface AdminModuleDeps {
  db: Kysely<Database>;
  users: UsersModule;
  /** Só `resetUserAccess`/`getSessionStats` (modules.md nota 22). */
  auth: Pick<AuthModule, "resetUserAccess" | "getSessionStats">;
  clinics: Pick<ClinicsModule, "adminListClinicAccounts" | "adminSuspendClinicAccount" | "adminReactivateClinicAccount">;
  /** Porta ligada no composition root a `families` (contagem apenas; `admin` não importa `families`). */
  families: AdminFamiliesPort<Kysely<Database>>;
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
    auth: deps.auth,
    families: deps.families,
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };
  const controller: AdminController = {
    adminListUsers: createAdminListUsersUseCase(accountsDeps),
    adminSuspendUser: createAdminSuspendUserUseCase(accountsDeps),
    adminReactivateUser: createAdminReactivateUserUseCase(accountsDeps),
    adminGetUser: createAdminGetUserUseCase(accountsDeps),
    adminResetUserAccess: createAdminResetUserAccessUseCase(accountsDeps),
    adminListClinicAccounts: deps.clinics.adminListClinicAccounts,
    adminSuspendClinicAccount: deps.clinics.adminSuspendClinicAccount,
    adminReactivateClinicAccount: deps.clinics.adminReactivateClinicAccount,
  };
  return { router: createAdminRouter(controller) };
}

export { createCreatePlatformAdminUseCase, type CreatePlatformAdminResult } from "./application/create-platform-admin.js";
