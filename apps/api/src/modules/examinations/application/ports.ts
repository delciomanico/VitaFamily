// Portas do módulo `examinations` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `access`/`clinics`/
// `documents` (modules.md §2: `examinations` depende de `access`, `clinics`, `documents`,
// `audit`). Genéricas em `Trx` para que esta camada nunca importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document, ResourceType } from "../../documents/index.js";
import type { ExamResult } from "../domain/exam-result.js";
import type { Examination, ExaminationStatus } from "../domain/examination.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Subconjunto de `AccessPolicy<Trx>` que `examinations` chama pela raiz (`access.policy`, modules.md §2). */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

/** Subconjunto da API pública de `clinics` (modules.md §2: `ClinicLookup`), mesmo critério de `appointments`. */
export interface ClinicsPort<Trx> {
  getBookableClinic(trx: Trx, familyId: string, clinicId: string): Promise<{ id: string; name: string } | null>;
}

/** Subconjunto da API pública de `documents` (modules.md §2) — documentos de um exame (FR-DOC-04). */
export interface DocumentsPort<Trx> {
  listForResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<Document[]>;
  deleteAllForResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<void>;
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

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface NewExaminationRecord {
  id: string;
  familyId: string;
  memberId: string;
  name: string;
  examDate: string;
  status: ExaminationStatus;
  clinicId?: string;
  clinicName?: string;
  notes?: string;
  createdAt: Date;
}

export interface ExaminationChanges {
  name?: string;
  examDate?: string;
  clinicId?: string | null;
  clinicName?: string | null;
  notes?: string | null;
}

export interface ExaminationListFilter {
  status?: ExaminationStatus;
  from?: string;
  to?: string;
}

/** `examinations` (schema.md §3) — propriedade exclusiva deste módulo (conventions.md §3.5). */
export interface ExaminationsRepository<Trx> {
  insert(trx: Trx, record: NewExaminationRecord): Promise<Examination>;
  findById(trx: Trx, familyId: string, memberId: string, examinationId: string): Promise<Examination | null>;
  listByMember(trx: Trx, familyId: string, memberId: string, filter: ExaminationListFilter, limit: number, cursor?: string): Promise<CursorPage<Examination>>;
  update(trx: Trx, familyId: string, memberId: string, examinationId: string, changes: ExaminationChanges): Promise<Examination>;
  updateStatus(trx: Trx, familyId: string, memberId: string, examinationId: string, status: ExaminationStatus): Promise<Examination>;
  delete(trx: Trx, familyId: string, memberId: string, examinationId: string): Promise<void>;
}

export interface NewExamResultRecord {
  id: string;
  examinationId: string;
  parameter: string;
  valueNumeric?: number;
  valueText?: string;
  unit?: string;
  referenceMin?: number;
  referenceMax?: number;
  createdAt: Date;
}

export interface ExamResultChanges {
  parameter?: string;
  valueNumeric?: number | null;
  valueText?: string | null;
  unit?: string | null;
  referenceMin?: number | null;
  referenceMax?: number | null;
}

export interface ExamResultHistoryItem {
  examinationId: string;
  examDate: string;
  valueNumeric?: number;
  valueText?: string;
  unit?: string;
  referenceMin?: number;
  referenceMax?: number;
}

/** `exam_results` (schema.md §3) — propriedade exclusiva deste módulo. */
export interface ExamResultsRepository<Trx> {
  insert(trx: Trx, record: NewExamResultRecord): Promise<ExamResult>;
  findById(trx: Trx, examinationId: string, resultId: string): Promise<ExamResult | null>;
  listByExamination(trx: Trx, examinationId: string): Promise<ExamResult[]>;
  update(trx: Trx, examinationId: string, resultId: string, changes: ExamResultChanges): Promise<ExamResult>;
  delete(trx: Trx, examinationId: string, resultId: string): Promise<void>;
  /** UC-EXM-04: histórico de um parâmetro ao longo do tempo, para um membro (join com `examinations`). */
  historyByParameter(trx: Trx, familyId: string, memberId: string, parameter: string): Promise<ExamResultHistoryItem[]>;
}

export interface ExaminationsDeps<Trx> {
  examinationsRepo: ExaminationsRepository<Trx>;
  examResultsRepo: ExamResultsRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  clinics: ClinicsPort<Trx>;
  documents: DocumentsPort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export type { ExamResult } from "../domain/exam-result.js";
export type { Examination, ExaminationStatus } from "../domain/examination.js";
