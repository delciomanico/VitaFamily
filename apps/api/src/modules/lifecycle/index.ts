// Raiz do módulo `lifecycle` (ADR-015/conventions.md §1). M9 (plan.md §4): por agora, exportação
// de dados (UC-ACC-06/P2). Maioridade, bloqueio e apagamento a 90 dias, saída/remoção com pacote
// e eliminação de conta ficam por implementar (ver README.md).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AuditModule } from "../audit/index.js";
import { createDeleteAccountUseCase } from "./application/delete-account.js";
import { createDownloadExportUseCase, createExportBeforeRemovalUseCase, createGetExportUseCase, createRequestExportUseCase } from "./application/exports.js";
import type { AccountDeletionPorts, ExportSources, ExportStorage, LifecycleDeps } from "./application/ports.js";
import { KyselyExportsRepository } from "./infrastructure/repo.js";
import { createLifecycleRouter, type LifecycleController } from "./interface/router.js";

export type { ExportSources } from "./application/ports.js";

export interface LifecycleModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  sources: ExportSources;
  /** Bucket de exportações (`S3_BUCKET_EXPORTS`). */
  storage: ExportStorage;
  onBuildError: (error: unknown, exportId: string) => void;
  account: AccountDeletionPorts<Kysely<Database>>;
}

export interface LifecycleModule {
  router: Router;
  /** Para `families` (porta `memberData`, ligada pela raiz): pacote gerado e esperado antes de apagar dados. */
  exportBeforeRemoval: ReturnType<typeof createExportBeforeRemovalUseCase<Kysely<Database>>>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createLifecycleModule(deps: LifecycleModuleDeps): LifecycleModule {
  const lifecycleDeps: LifecycleDeps<Kysely<Database>> = {
    exportsRepo: new KyselyExportsRepository(),
    sources: deps.sources,
    storage: deps.storage,
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    onBuildError: deps.onBuildError,
    account: deps.account,
  };
  const controller: LifecycleController = {
    requestExport: createRequestExportUseCase(lifecycleDeps),
    getExport: createGetExportUseCase(lifecycleDeps),
    downloadExport: createDownloadExportUseCase(lifecycleDeps),
    deleteAccount: createDeleteAccountUseCase(lifecycleDeps),
  };
  return { router: createLifecycleRouter(controller), exportBeforeRemoval: createExportBeforeRemovalUseCase(lifecycleDeps) };
}
