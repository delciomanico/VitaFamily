// Fakes em memória das portas de `documents` para testes de casos de uso (mesmo padrão de
// `health-records/application/fixtures.ts`). Não é ficheiro de teste.
import type { Clock } from "../../../platform/clock/index.js";
import { InMemoryStorage } from "../../../platform/storage/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document } from "../domain/document.js";
import { InMemoryRateLimiter } from "../domain/rate-limiter.js";
import type {
  AccessPolicyPort,
  AuditPort,
  DocumentsDeps,
  DocumentsRepository,
  FileDeletionsRepository,
  NewDocumentRecord,
  ScanQueuePort,
  VirusScanner,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

/** Mesmo critério de `health-records/application/fixtures.ts`: simula ALLOW/DENY, grava os pedidos. */
export class FakeAccessPolicy implements AccessPolicyPort<FakeTrx> {
  readonly calls: CanInput[] = [];
  relation: Relation = "SELF";
  denyWith?: Error;

  async can(_trx: FakeTrx, input: CanInput): Promise<AccessContext> {
    this.calls.push(input);
    if (this.denyWith) {
      throw this.denyWith;
    }
    return Promise.resolve({
      actor: { id: "actor-1", familyId: input.familyId, name: "Actor", isDependent: false, status: "ACTIVE" },
      subject: {
        id: input.subjectMemberId ?? "subject-1",
        familyId: input.familyId,
        name: "Subject",
        isDependent: false,
        status: "ACTIVE",
      },
      relation: this.relation,
    });
  }
}

export class FakeDocumentsRepository implements DocumentsRepository<FakeTrx> {
  readonly byId = new Map<string, Document>();

  async insert(_trx: FakeTrx, record: NewDocumentRecord): Promise<Document> {
    const document: Document = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      storageKey: record.storageKey,
      originalName: record.originalName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      checksumSha256: record.checksumSha256,
      scanStatus: "PENDING",
      createdAt: record.createdAt,
      ...(record.uploadedBy !== undefined ? { uploadedBy: record.uploadedBy } : {}),
    };
    this.byId.set(document.id, document);
    return Promise.resolve(document);
  }

  async findById(_trx: FakeTrx, familyId: string, memberId: string, documentId: string): Promise<Document | null> {
    const document = this.byId.get(documentId);
    return Promise.resolve(
      document?.familyId === familyId && document.memberId === memberId ? document : null,
    );
  }

  async findByIdForFamily(_trx: FakeTrx, familyId: string, documentId: string): Promise<Document | null> {
    const document = this.byId.get(documentId);
    return Promise.resolve(document?.familyId === familyId ? document : null);
  }

  async listByResource(
    _trx: FakeTrx,
    familyId: string,
    memberId: string,
    resourceType: Document["resourceType"],
    resourceId: string,
  ): Promise<Document[]> {
    return Promise.resolve(
      [...this.byId.values()].filter(
        (d) =>
          d.familyId === familyId &&
          d.memberId === memberId &&
          d.resourceType === resourceType &&
          d.resourceId === resourceId,
      ),
    );
  }

  async countByResource(
    trx: FakeTrx,
    familyId: string,
    memberId: string,
    resourceType: Document["resourceType"],
    resourceId: string,
  ): Promise<number> {
    const docs = await this.listByResource(trx, familyId, memberId, resourceType, resourceId);
    return docs.length;
  }

  async sumSizeByFamily(_trx: FakeTrx, familyId: string): Promise<number> {
    return Promise.resolve(
      [...this.byId.values()].filter((d) => d.familyId === familyId).reduce((sum, d) => sum + d.sizeBytes, 0),
    );
  }

  async markClean(_trx: FakeTrx, documentId: string, finalStorageKey: string): Promise<Document> {
    const document = this.byId.get(documentId);
    if (!document) {
      throw new Error("documento inexistente no fake");
    }
    const updated: Document = { ...document, scanStatus: "CLEAN", storageKey: finalStorageKey };
    this.byId.set(documentId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, familyId: string, memberId: string, documentId: string): Promise<void> {
    const document = this.byId.get(documentId);
    if (document?.familyId === familyId && document.memberId === memberId) {
      this.byId.delete(documentId);
    }
    return Promise.resolve();
  }

  seed(document: Document): void {
    this.byId.set(document.id, document);
  }
}

export class FakeFileDeletionsRepository implements FileDeletionsRepository<FakeTrx> {
  readonly enqueued: string[] = [];

  async enqueue(_trx: FakeTrx, storageKey: string): Promise<void> {
    this.enqueued.push(storageKey);
    return Promise.resolve();
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

/** Resultado configurável pelo teste (CLEAN por defeito); `scan()` grava os buffers recebidos. */
export class FakeVirusScanner implements VirusScanner {
  result: "CLEAN" | "INFECTED" = "CLEAN";
  readonly scanned: Buffer[] = [];

  async scan(buffer: Buffer): Promise<"CLEAN" | "INFECTED"> {
    this.scanned.push(buffer);
    return Promise.resolve(this.result);
  }
}

export class FakeScanQueue implements ScanQueuePort {
  readonly jobs: { documentId: string; familyId: string }[] = [];

  async enqueueScan(job: { documentId: string; familyId: string }): Promise<void> {
    this.jobs.push(job);
    return Promise.resolve();
  }
}

export interface DocumentsFixtures {
  deps: DocumentsDeps<FakeTrx>;
  documentsRepo: FakeDocumentsRepository;
  fileDeletionsRepo: FakeFileDeletionsRepository;
  policy: FakeAccessPolicy;
  audit: FakeAuditPort;
  storage: InMemoryStorage;
  virusScanner: FakeVirusScanner;
  scanQueue: FakeScanQueue;
}

export function createDocumentsFixtures(clock: Clock): DocumentsFixtures {
  const documentsRepo = new FakeDocumentsRepository();
  const fileDeletionsRepo = new FakeFileDeletionsRepository();
  const policy = new FakeAccessPolicy();
  const audit = new FakeAuditPort();
  const storage = new InMemoryStorage();
  const virusScanner = new FakeVirusScanner();
  const scanQueue = new FakeScanQueue();
  const deps: DocumentsDeps<FakeTrx> = {
    documentsRepo,
    fileDeletionsRepo,
    policy,
    audit,
    storage,
    virusScanner,
    scanQueue,
    rateLimiter: new InMemoryRateLimiter(clock),
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
    maxFileSizeBytes: 10_485_760,
    maxFilesPerResource: 5,
    maxFamilyStorageBytes: 104_857_600,
  };
  return { deps, documentsRepo, fileDeletionsRepo, policy, audit, storage, virusScanner, scanQueue };
}
