// Raiz do módulo `documents` (ADR-015/conventions.md §1): única API pública importável por outros
// módulos (`prescriptions`, `examinations`, `lifecycle`, `reports` — M6+, modules.md §2) e pelo
// composition root (`main/api.ts`, `main/worker.ts`). M5 (plan.md §4): armazenamento, validação,
// antivírus, download mediado, quotas (FR-DOC, BR-DOC). Depende só de `access` (autorização por
// categoria, `access.policy.can()`) e `audit` (modules.md §2) — nunca de `prescriptions`/
// `examinations` (ainda não existem; ver `README.md`, decisão de change control pré-aprovada).
//
// Duas raízes de composição (modules.md §4: a API atende pedidos HTTP; só o worker corre
// `documents.scan`/antivírus): `createDocumentsModule` (processo "api", precisa de `access` para
// autorizar) e `createDocumentsWorkerModule` (processo "worker", só precisa de `storage`+
// `virusScanner`+`audit`+`clock` — nunca de `access`/`families`, porque o scan nunca autoriza nada,
// `ScanDocumentDeps` em `application/ports.ts`).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type PgBoss from "pg-boss";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { Storage } from "../../platform/storage/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import { createDeleteDocumentUseCase } from "./application/delete-document.js";
import { createDownloadDocumentUseCase } from "./application/download-document.js";
import { createDeleteAllForResourceUseCase, createListForResourceUseCase } from "./application/for-resource.js";
import { createGetDocumentUseCase } from "./application/get-document.js";
import { createListDocumentsUseCase } from "./application/list-documents.js";
import type { DocumentsDeps, ScanDocumentDeps, VirusScanner } from "./application/ports.js";
import { createScanDocumentUseCase } from "./application/scan-document.js";
import { createUploadDocumentUseCase } from "./application/upload-document.js";
import { InMemoryRateLimiter } from "./domain/rate-limiter.js";
import { KyselyDocumentsRepository, KyselyFileDeletionsRepository } from "./infrastructure/repo.js";
import { PgBossScanQueue, registerScanWorker } from "./infrastructure/scan-queue.js";
import { createDocumentsRouter, type DocumentsController } from "./interface/router.js";

export type { Document, ResourceType, ScanStatus } from "./domain/document.js";
export type { VirusScanner } from "./application/ports.js";
export { ClamAvScanner } from "./infrastructure/clamav-client.js";
export { MinioStorage, InMemoryStorage } from "../../platform/storage/index.js";

export interface DocumentsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clock: Clock;
  storage: Storage;
  /** Precisa de existir mas só é chamado pelo worker (`registerWorker`, `createDocumentsWorkerModule`). */
  virusScanner: VirusScanner;
  /** Só para enfileirar (`send`); registar o consumo é `createDocumentsWorkerModule`. */
  boss: PgBoss;
  /** `UPLOAD_MAX_BYTES` (environment.md §2). */
  maxFileSizeBytes: number;
  /** `FAMILY_STORAGE_QUOTA_BYTES` (environment.md §2). */
  maxFamilyStorageBytes: number;
  /** BR-DOC-03/Q10 — 5 por desenho, não configurável por ambiente (regra de negócio, não operação). */
  maxFilesPerResource?: number;
}

export interface DocumentsModule {
  router: Router;
  /** API pública para M6/M7 (ver README.md: documentos de receitas/exames). */
  listForResource: ReturnType<typeof createListForResourceUseCase<Kysely<Database>>>;
  deleteAllForResource: ReturnType<typeof createDeleteAllForResourceUseCase<Kysely<Database>>>;
}

/** Composition root do processo "api" (main/api.ts). */
export function createDocumentsModule(deps: DocumentsModuleDeps): DocumentsModule {
  const documentsRepo = new KyselyDocumentsRepository();
  const fileDeletionsRepo = new KyselyFileDeletionsRepository();
  const scanQueue = new PgBossScanQueue(deps.boss);

  const documentsDeps: DocumentsDeps<Kysely<Database>> = {
    documentsRepo,
    fileDeletionsRepo,
    policy: deps.access.policy,
    audit: deps.audit,
    storage: deps.storage,
    virusScanner: deps.virusScanner,
    scanQueue,
    rateLimiter: new InMemoryRateLimiter(deps.clock),
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    maxFileSizeBytes: deps.maxFileSizeBytes,
    maxFilesPerResource: deps.maxFilesPerResource ?? 5,
    maxFamilyStorageBytes: deps.maxFamilyStorageBytes,
  };

  const controller: DocumentsController = {
    uploadDocument: createUploadDocumentUseCase(documentsDeps),
    listDocuments: createListDocumentsUseCase(documentsDeps),
    getDocument: createGetDocumentUseCase(documentsDeps),
    deleteDocument: createDeleteDocumentUseCase(documentsDeps),
    downloadDocument: createDownloadDocumentUseCase(documentsDeps),
  };

  return {
    router: createDocumentsRouter(controller),
    listForResource: createListForResourceUseCase(documentsDeps),
    deleteAllForResource: createDeleteAllForResourceUseCase(documentsDeps),
  };
}

export interface DocumentsWorkerModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  storage: Storage;
  virusScanner: VirusScanner;
  boss: PgBoss;
}

export interface DocumentsWorkerModule {
  /** Regista o handler do job `documents.scan` (modules.md §5) — só o processo "worker" chama isto. */
  registerWorker: () => Promise<string>;
}

/** Composition root do processo "worker" (main/worker.ts) — nunca monta `access`/`families`. */
export function createDocumentsWorkerModule(deps: DocumentsWorkerModuleDeps): DocumentsWorkerModule {
  const scanDeps: ScanDocumentDeps<Kysely<Database>> = {
    documentsRepo: new KyselyDocumentsRepository(),
    storage: deps.storage,
    virusScanner: deps.virusScanner,
    audit: deps.audit,
    clock: deps.clock,
    withTransaction: (fn) => withTransaction(deps.db, fn),
  };
  const scanDocument = createScanDocumentUseCase(scanDeps);

  return {
    registerWorker: () => registerScanWorker(deps.boss, scanDocument),
  };
}
