// Portas do módulo `examinations` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `access`/`clinics`/
// `documents` (modules.md §2: `examinations` depende de `access`, `clinics`, `documents`,
// `audit`). Genéricas em `Trx` para que esta camada nunca importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { RateLimiter } from "../../../platform/rate-limit/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document, ResourceType } from "../../documents/index.js";
import type { ExamResult } from "../domain/exam-result.js";
import type { Examination, ExaminationStatus } from "../domain/examination.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/**
 * Ator do portal da clínica (ADR-020, `platform/actor.ClinicActorInfo`) — só os campos que
 * `examinations/application` precisa (mesmo critério de `appointments/application/ports.ts`: a
 * leitura de `platform/actor` é da `interface`, conventions.md §3.9).
 */
export interface ClinicPortalActor {
  clinicAccountId: string;
  clinicId: string;
  /** M14 R (BR-CLN-39): só no Médico — filtra por exames do seu profissional e esconde `receiptId`. */
  professionalId?: string;
}

/** `access.getMemberName` (BR-CLN-03): nome do membro para `ClinicExamBooking.patientName` — o mínimo. */
export interface MemberNamesPort<Trx> {
  getMemberName(trx: Trx, familyId: string, memberId: string): Promise<string | null>;
}

/**
 * Subconjunto da API pública de `alerts` (D19/ADR-023 revisto: `exam.cancelled|results`) —
 * ligado só no composition root (`examinations` não importa `alerts`, que depende de `examinations`).
 * Corre na transação do chamador.
 */
export interface ExamAlertsPort<Trx> {
  raiseExamEvent(trx: Trx, input: { type: "EXAM_CANCELLED" | "EXAM_RESULTS_AVAILABLE"; examinationId: string; familyId: string; memberId: string }): Promise<number>;
}

/** Horário de clínica parceira (`ClinicSlot`, API pública de `clinics`) — só o que `examinations` precisa (BR-EXM-05). */
export interface ClinicSlotLite {
  id: string;
  clinicId: string;
  kind: "APPOINTMENT" | "EXAM";
  /** Em `kind=EXAM` é o tipo de exame. */
  specialty: string;
  startsAt: Date;
  durationMinutes: number;
  /** BR-APT-11: vagas do horário. */
  capacity: number;
  /** M14 (BR-CLN-13): profissional do catálogo; nulo nos horários manuais antigos. */
  professionalId?: string;
}

/** Subconjunto de `AccessPolicy<Trx>` que `examinations` chama pela raiz (`access.policy`, modules.md §2). */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

/** Subconjunto da API pública de `clinics` (modules.md §2: `ClinicLookup`), mesmo critério de `appointments`. */
export interface ClinicsPort<Trx> {
  getBookableClinic(trx: Trx, familyId: string, clinicId: string): Promise<{ id: string; name: string } | null>;
  /** BR-APT-11: `ExaminationInput.slotId` não traz `clinicId` (openapi) — o horário resolve-se só pelo id
   * e é BLOQUEADO (`SELECT … FOR UPDATE`) na transação do chamador, que serializa as marcações. */
  lockSlot(trx: Trx, slotId: string): Promise<ClinicSlotLite | null>;
  /** M14 R (BR-CLN-39): horário pelo id (sem bloqueio) — o Médico só age em exames do seu profissional. */
  findSlotById(slotId: string): Promise<ClinicSlotLite | null>;
}

/** `ReceiptIds` (M14 R, BR-CLN-31): `ClinicExamBooking.receiptId`; implementada por `clinic-receipts`, ligada no composition root. */
export interface ReceiptIdsPort<Trx> {
  findIssuedReceiptIds(trx: Trx, clinicId: string, kind: "EXAM", bookingIds: string[]): Promise<Map<string, string>>;
}

/** Subconjunto da API pública de `documents` (modules.md §2) — documentos de um exame (FR-DOC-04). */
export interface DocumentsPort<Trx> {
  listForResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<Document[]>;
  /** BR-CLN-08 (D19): upload/remoção de PDF pelo portal da clínica — `resolveTarget` corre dentro da transação de `documents`. */
  uploadClinicExamDocument(
    actor: { clinicAccountId: string },
    input: { examinationId: string; file: { buffer: Buffer; originalName: string } },
    resolveTarget: (trx: Trx) => Promise<{ familyId: string; memberId: string }>,
    context: RequestContext,
  ): Promise<Document>;
  deleteClinicExamDocument(
    actor: { clinicAccountId: string },
    input: { examinationId: string; documentId: string },
    resolveTarget: (trx: Trx) => Promise<{ familyId: string; memberId: string }>,
    context: RequestContext,
  ): Promise<void>;
  deleteAllForResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<void>;
  /** M15 T (BR-CLN-49): grava o laudo PDF gerado (nasce `CLEAN`, sem quarentena) na transação do chamador. */
  storeGenerated(
    trx: Trx,
    input: { familyId: string; memberId: string; examinationId: string; originalName: string; bytes: Buffer; clinicAccountId: string },
  ): Promise<Document>;
  /** O objeto do laudo ficou órfão (a transação do exame reverteu): vai para `file_deletions`. */
  discardStored(storageKey: string): Promise<void>;
  /** M15 T (BR-CLN-49): bytes do laudo gerado; `null` se o titular o apagou. */
  readGeneratedExamReport(trx: Trx, familyId: string, memberId: string, examinationId: string): Promise<{ document: Document; bytes: Buffer } | null>;
}

/** M15 T (BR-CLN-48): pedido de geração do laudo (implementada por `clinic-reports`, ligada no composition root). */
export interface ExamReportRequest {
  clinicId: string;
  slotId?: string;
  patientName: string;
  examName: string;
  /** `AAAA-MM-DD`. */
  examDate: string;
  results: ExamResultDraftItem[];
  resultNote: string | null;
}

export interface ExamReportGeneratorPort<Trx> {
  generate(trx: Trx, request: ExamReportRequest): Promise<{ bytes: Buffer; resultsCount: number; outOfReferenceCount: number }>;
}

/**
 * M15 U (ADR-028, BR-CLN-52, modules.md §2 nota 28): propagação do estado do `ExamOrder` ligado a um exame. Definida aqui,
 * implementada por `clinic-reports` e ligada no composition root (`examinations` nunca importa `clinic-reports`). Todas as
 * operações correm NA transação do exame. `link` valida `VIEW_EXAM_ORDERS` (senão `FORBIDDEN`/`NOT_FOUND`) e `ORDERED` (senão `CONFLICT`).
 */
export interface ExamOrderLinkerPort<Trx> {
  link(
    trx: Trx,
    input: { actor: ActorIdentity; familyId: string; memberId: string; orderId: string; examinationId: string; examClinicId?: string; status: "SCHEDULED" | "COMPLETED" },
    context: RequestContext,
  ): Promise<void>;
  /** Exame cancelado/apagado: o pedido volta a `ORDERED` (idempotente). */
  release(trx: Trx, examinationId: string): Promise<void>;
  /** Exame `COMPLETED`: o pedido passa a `FULFILLED` (idempotente). */
  fulfil(trx: Trx, examinationId: string): Promise<void>;
}

/** Forma de `ExamResultInput` (openapi.yaml), validada com as MESMAS regras de BR-CLN-08. */
export interface ExamResultDraftItem {
  parameter: string;
  valueNumeric?: number | null;
  valueText?: string | null;
  unit?: string | null;
  referenceMin?: number | null;
  referenceMax?: number | null;
}

/** `clinic_exam_result_drafts` (M15 T, BR-CLN-47): dado de saúde, nunca em logs/auditoria. */
export interface ExamResultsDraft {
  examinationId: string;
  results: ExamResultDraftItem[];
  resultNote: string | null;
  updatedAt: Date;
}

export interface SaveExamResultsDraft {
  examinationId: string;
  results: ExamResultDraftItem[];
  resultNote: string | null;
  clinicAccountId: string;
  now: Date;
}

export interface ExamResultsDraftRepository<Trx> {
  find(trx: Trx, examinationId: string): Promise<ExamResultsDraft | null>;
  /** Substitui o rascunho anterior (última escrita ganha). */
  upsert(trx: Trx, draft: SaveExamResultsDraft): Promise<ExamResultsDraft>;
  /** `true` se existia. */
  delete(trx: Trx, examinationId: string): Promise<boolean>;
  /** Decora `ClinicExamBooking.hasResultsDraft`. */
  existingIds(trx: Trx, examinationIds: string[]): Promise<Set<string>>;
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
  /** D19: horário de origem e hora congelada (só marcações em horário da clínica). */
  slotId?: string;
  scheduledAt?: Date;
  notes?: string;
  createdAt: Date;
}

/** Transição de estado feita pela clínica (D19): grava sempre o motivo (`responseNote`). */
export interface ClinicExamStatusChange {
  status: ExaminationStatus;
  responseNote?: string | null;
}

/** BR-CLN-08: `SCHEDULED -> COMPLETED` pela clínica, com a rastreabilidade (espelho de BR-RX-07). */
export interface ClinicExamCompletion {
  clinicAccountId: string;
  issuedAt: Date;
  resultNote?: string | null;
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
export interface ClinicExamsFilter {
  from?: Date;
  /** Exclusivo. */
  to?: Date;
  familyId?: string;
  memberId?: string;
}

export interface ExaminationsRepository<Trx> {
  insert(trx: Trx, record: NewExaminationRecord): Promise<Examination>;
  findById(trx: Trx, familyId: string, memberId: string, examinationId: string): Promise<Examination | null>;
  listByMember(trx: Trx, familyId: string, memberId: string, filter: ExaminationListFilter, limit: number, cursor?: string): Promise<CursorPage<Examination>>;
  update(trx: Trx, familyId: string, memberId: string, examinationId: string, changes: ExaminationChanges): Promise<Examination>;
  updateStatus(trx: Trx, familyId: string, memberId: string, examinationId: string, status: ExaminationStatus): Promise<Examination>;
  delete(trx: Trx, familyId: string, memberId: string, examinationId: string): Promise<void>;
  /** `alerts.scan` (M8, modules.md §3 nota 3): candidatas a `exam.24h` — `SCHEDULED` com
   * `exam_date` dentro de `[from, to]` (datas, sem hora; `alerts` resolve o fuso efetivo do
   * sujeito e decide por regra pura se o instante exato já foi atingido). `alerts` nunca acede a
   * `examinations` diretamente (conventions.md §3.5). */
  listReminderCandidates(trx: Trx, from: string, to: string, limit: number): Promise<Examination[]>;
  /** BR-APT-11: exames `SCHEDULED` por horário (só os que têm marcações). A contagem que decide a
   * reserva corre depois de `clinics.lockSlot` (bloqueio do horário); sem ele, é só informativa. */
  countScheduledBySlot(trx: Trx, slotIds: string[]): Promise<{ slotId: string; count: number }[]>;
  /** BR-APT-11: o membro já tem exame `SCHEDULED` neste horário? (rede de segurança: UNIQUE parcial `(slot_id, member_id)`). */
  existsScheduledForMember(trx: Trx, slotId: string, memberId: string): Promise<boolean>;
  /** Portal da clínica (authorization.md §6.1 passo 2): só devolve o exame se for da própria clínica
   * e tiver nascido de um horário (`scheduled_at`) — nunca um exame que a família registou à mão. */
  findByClinicId(trx: Trx, clinicId: string, examinationId: string): Promise<Examination | null>;
  listByClinicAndStatus(trx: Trx, clinicId: string, statuses: ExaminationStatus[], filter: { from?: Date; to?: Date }): Promise<Examination[]>;
  /** M14 P (`clinic-patients`, leitura): exames `SCHEDULED|COMPLETED` da clínica com horário, por `scheduled_at`
   * (`[from, to)`), opcionalmente de um membro; com `limit` devolve os mais recentes primeiro. */
  listForClinic(trx: Trx, clinicId: string, filter: ClinicExamsFilter, limit?: number): Promise<Examination[]>;
  /** M14 P (BR-CLN-21, `clinic-patients`): exames `SCHEDULED|COMPLETED` do membro com `exam_date >= since` (AAAA-MM-DD). */
  listSharedByMember(trx: Trx, familyId: string, memberId: string, since: string): Promise<Examination[]>;
  /** Único escritor de `status`+`response_note` para o portal/sistema — nunca `familyId`/`memberId`. */
  updateStatusByClinic(trx: Trx, examinationId: string, change: ClinicExamStatusChange): Promise<Examination>;
  completeByClinic(trx: Trx, examinationId: string, completion: ClinicExamCompletion): Promise<Examination>;
  /** BR-CLN-08: o exame está `COMPLETED`? (liberta os PDF da clínica ao paciente). */
  isCompleted(trx: Trx, familyId: string, memberId: string, examinationId: string): Promise<boolean>;
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
  /** M15 T (BR-CLN-47). */
  draftsRepo: ExamResultsDraftRepository<Trx>;
  /** M15 T (BR-CLN-48/49): laudo PDF (implementada por `clinic-reports`). */
  reportGenerator: ExamReportGeneratorPort<Trx>;
  /** M15 U (BR-CLN-52): estado do pedido de exame ligado (implementada por `clinic-reports`). */
  examOrders: ExamOrderLinkerPort<Trx>;
  /** M15 T: 60/min nas escritas do rascunho, 30/min no PDF do laudo (PROPOSTO). */
  limiter: RateLimiter;
  policy: AccessPolicyPort<Trx>;
  memberNames: MemberNamesPort<Trx>;
  alerts: ExamAlertsPort<Trx>;
  clinics: ClinicsPort<Trx>;
  documents: DocumentsPort<Trx>;
  receipts: ReceiptIdsPort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export type { ExamResult } from "../domain/exam-result.js";
export type { Examination, ExaminationIssuer, ExaminationStatus } from "../domain/examination.js";
