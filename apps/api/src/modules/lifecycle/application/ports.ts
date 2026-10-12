// Portas de `lifecycle` (conventions.md §3.2). As leituras de dados de saúde são as APIs públicas
// dos módulos dono (já aplicam `AccessPolicy` e auditoria), ligadas no composition root; o
// pacote de exportação nunca contém mais do que o pedinte já pode ler.
import type { Readable } from "node:stream";
import type { Clock } from "../../../platform/clock/index.js";
import type { MemberPageRead, MemberRead, ReadActor, ReadContext } from "../../../platform/reads/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { DataExport, ExportReason } from "../domain/export.js";

export type { ReadActor as ActorIdentity, ReadContext as RequestContext };

export type ApiObject = Record<string, unknown>;

export interface NewExportRecord {
  id: string;
  requestedBy: string;
  familyId?: string;
  subjectMemberId?: string;
  reason: ExportReason;
  createdAt: Date;
}

export interface ExportsRepository<Trx> {
  insert(trx: Trx, record: NewExportRecord): Promise<DataExport>;
  /** Só o próprio pedinte vê o seu pedido (sem enumeração, errors.md regra 2). */
  findById(trx: Trx, id: string, requestedBy: string): Promise<DataExport | null>;
  countSince(trx: Trx, requestedBy: string, since: Date): Promise<number>;
  markReady(trx: Trx, id: string, storageKey: string, expiresAt: Date): Promise<void>;
  markFailed(trx: Trx, id: string): Promise<void>;
}

/** Pacote guardado no bucket de exportações (ADR-006: nunca público, descarga mediada). */
export interface ExportStorage {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Readable>;
}

export interface ExportSources {
  account: (userId: string) => Promise<{ name: string; email: string; birthDate: string; timezone: string } | null>;
  listFamilies: (userId: string) => Promise<ApiObject[]>;
  listMembers: (userId: string, familyId: string) => Promise<ApiObject[]>;
  bloodType: MemberRead<string>;
  allergies: MemberRead<ApiObject[]>;
  conditions: MemberRead<ApiObject[]>;
  prescriptions: MemberPageRead;
  plans: MemberPageRead;
  doses: MemberPageRead;
  appointments: MemberPageRead;
  examinations: MemberPageRead;
  /** Documentos de uma receita ou de um exame (a listagem exige o recurso). */
  documents: (actor: ReadActor, familyId: string, memberId: string, resourceType: "PRESCRIPTION" | "EXAMINATION", resourceId: string) => Promise<ApiObject[]>;
  downloadDocument: (
    actor: ReadActor,
    familyId: string,
    memberId: string,
    documentId: string,
    context: ReadContext,
  ) => Promise<{ originalName: string; stream: Readable }>;
}

export interface LifecycleDeps<Trx> {
  exportsRepo: ExportsRepository<Trx>;
  sources: ExportSources;
  storage: ExportStorage;
  audit: { record: (trx: Trx, event: AuditEvent) => Promise<void> };
  withTransaction: <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;
  clock: Clock;
  /** Falhas da geração em segundo plano (o pedido já respondeu 202); só registo técnico. */
  onBuildError: (error: unknown, exportId: string) => void;
}
