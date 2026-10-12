// Raiz do módulo `lifecycle` (ADR-015/conventions.md §1). M9 (plan.md §4): por agora, exportação
// de dados (UC-ACC-06/P2). Maioridade, bloqueio e apagamento a 90 dias, saída/remoção com pacote
// e eliminação de conta ficam por implementar (ver README.md).
import type { Router } from "express";
import type PgBoss from "pg-boss";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AuditModule } from "../audit/index.js";
import { createExpireExportsUseCase } from "./application/expire-exports.js";
import { createMemberLifecycleJobs, type MemberLifecycleDeps } from "./application/member-lifecycle.js";
import { createDeleteAccountUseCase } from "./application/delete-account.js";
import { createDownloadExportUseCase, createExportBeforeRemovalUseCase, createGetExportUseCase, createRequestExportUseCase } from "./application/exports.js";
import type { AccountDeletionPorts, ExportSources, ExportStorage, LifecycleDeps } from "./application/ports.js";
import { registerBlockedMembersWorker, registerComingOfAgeWorker, registerExpireExportsWorker } from "./infrastructure/jobs.js";
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

export interface LifecycleWorkerModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  boss: PgBoss;
  /** Operações de `families` sobre membros (maioridade/bloqueio). */
  members: MemberLifecycleDeps<Kysely<Database>>["members"];
  emailOf: MemberLifecycleDeps<Kysely<Database>>["emailOf"];
  mailer: MemberLifecycleDeps<Kysely<Database>>["mailer"];
  purgeMemberFiles: MemberLifecycleDeps<Kysely<Database>>["purgeMemberFiles"];
  /** Bucket de exportações. */
  exportsStorage: Pick<ExportStorage, "deleteObject">;
  onNotifyError: (error: unknown) => void;
}

export interface LifecycleWorkerModule {
  /** Regista os jobs agendados `lifecycle.*` — só o processo "worker" chama isto. */
  registerWorkers: () => Promise<void>;
}

/** Composition root do processo "worker" (main/worker.ts): nunca monta `access` nem módulos de saúde. */
export function createLifecycleWorkerModule(deps: LifecycleWorkerModuleDeps): LifecycleWorkerModule {
  const withTx = <T>(fn: (trx: Kysely<Database>) => Promise<T>) => withTransaction(deps.db, fn);
  const jobs = createMemberLifecycleJobs<Kysely<Database>>({
    members: deps.members,
    emailOf: deps.emailOf,
    mailer: deps.mailer,
    purgeMemberFiles: deps.purgeMemberFiles,
    audit: deps.audit,
    withTransaction: withTx,
    clock: deps.clock,
    onNotifyError: deps.onNotifyError,
  });
  const expireExports = createExpireExportsUseCase({
    repo: new KyselyExportsRepository(),
    storage: deps.exportsStorage,
    clock: deps.clock,
    withTransaction: withTx,
  });
  return {
    registerWorkers: async () => {
      await registerComingOfAgeWorker(deps.boss, jobs.comingOfAge);
      await registerBlockedMembersWorker(deps.boss, jobs.blockedMembers);
      await registerExpireExportsWorker(deps.boss, expireExports);
    },
  };
}
