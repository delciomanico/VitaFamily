// Portas do módulo `documents` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg, MinIO, ClamAV, pg-boss) ou ligadas à raiz a partir da API pública de
// `access` (modules.md §2: `documents` depende só de `access`, `audit`). Genéricas em `Trx` para que
// esta camada nunca importe "kysely"/"pg-boss"/"minio" (banido em domain/application,
// conventions.md §3.9) — `Storage` é a excepção: é o próprio tipo da porta partilhada
// (`platform/storage`), sem implementação concreta aqui.
import type { Readable } from "node:stream";
import type { Clock } from "../../../platform/clock/index.js";
import type { Storage } from "../../../platform/storage/index.js";
import type { AccessContext, ActorIdentity, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document, ResourceType, ScanStatus } from "../domain/document.js";
import type { InMemoryRateLimiter } from "../domain/rate-limiter.js";

export type { ActorIdentity };

/**
 * Subconjunto de `AccessPolicy<Trx>` (`access/application/policy.ts`) que `documents` chama pela
 * raiz (`access.policy`, modules.md §2) — reconstruído a partir dos tipos exportados por
 * `access/index.js`, mesmo critério de `health-records/application/ports.ts`.
 */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface NewDocumentRecord {
  id: string;
  familyId: string;
  memberId: string;
  resourceType: ResourceType;
  resourceId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadedBy?: string;
  createdAt: Date;
}

/** `documents` (schema.md §3) — propriedade exclusiva deste módulo (conventions.md §3.5). */
export interface DocumentsRepository<Trx> {
  insert(trx: Trx, record: NewDocumentRecord): Promise<Document>;
  findById(trx: Trx, familyId: string, memberId: string, documentId: string): Promise<Document | null>;
  /** Só por `familyId` — usado pelo worker `documents.scan`, que não recebe `memberId` no job. */
  findByIdForFamily(trx: Trx, familyId: string, documentId: string): Promise<Document | null>;
  listByResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<Document[]>;
  countByResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<number>;
  /** Soma de `size_bytes` de toda a família (Q10: 100 MB por família, não por membro/recurso). */
  sumSizeByFamily(trx: Trx, familyId: string): Promise<number>;
  /** `PENDING` -> `CLEAN` (worker, scan limpo): atualiza `scan_status` e a `storage_key` final. */
  markClean(trx: Trx, documentId: string, finalStorageKey: string): Promise<Document>;
  delete(trx: Trx, familyId: string, memberId: string, documentId: string): Promise<void>;
}

/** `file_deletions` (schema.md §5/§7, ADR-011) — outbox de apagamento de ficheiros. */
export interface FileDeletionsRepository<Trx> {
  enqueue(trx: Trx, storageKey: string): Promise<void>;
}

/** Resultado do antivírus (ADR-006, BR-DOC-02); scanner real implementado sobre o protocolo
 * INSTREAM do ClamAV (`infrastructure/clamav-client.ts`), documentado no README do módulo. */
export interface VirusScanner {
  scan(buffer: Buffer): Promise<"CLEAN" | "INFECTED">;
}

/** Fila `documents.scan` (pg-boss, modules.md §5) — porta para `application` nunca importar "pg-boss". */
export interface ScanQueuePort {
  enqueueScan(job: { documentId: string; familyId: string }): Promise<void>;
}

export interface DocumentsDeps<Trx> {
  documentsRepo: DocumentsRepository<Trx>;
  fileDeletionsRepo: FileDeletionsRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  audit: AuditPort<Trx>;
  storage: Storage;
  virusScanner: VirusScanner;
  scanQueue: ScanQueuePort;
  rateLimiter: InMemoryRateLimiter;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  /** `UPLOAD_MAX_BYTES` (environment.md §2, BR-DOC-01: ≤10 MB). */
  maxFileSizeBytes: number;
  /** BR-DOC-03/Q10: 5 ficheiros por recurso. */
  maxFilesPerResource: number;
  /** `FAMILY_STORAGE_QUOTA_BYTES` (BR-DOC-03/Q10: 100 MB por família). */
  maxFamilyStorageBytes: number;
}

export type { Document, ResourceType, ScanStatus };
export type DownloadStream = Readable;

/**
 * Subconjunto de `DocumentsDeps` que o worker `documents.scan` precisa (`scan-document.ts`) — não
 * inclui `policy`/`rateLimiter`/`scanQueue`/quotas porque o scan nunca autoriza nem enfileira-se a
 * si próprio. Permite ao processo "worker" (main/worker.ts) não ter de montar `access`/`families`
 * só para correr o antivírus (modules.md §4: só os módulos ligados a filas correm lá).
 * `DocumentsDeps<Trx>` continua estruturalmente compatível (sobreconjunto), por isso
 * `createDocumentsModule` (processo "api") pode continuar a usar o mesmo objeto para os dois.
 */
export interface ScanDocumentDeps<Trx> {
  documentsRepo: DocumentsRepository<Trx>;
  storage: Storage;
  virusScanner: VirusScanner;
  audit: AuditPort<Trx>;
  clock: Clock;
  withTransaction: WithTransaction<Trx>;
}
