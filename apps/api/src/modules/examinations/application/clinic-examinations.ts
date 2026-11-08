// Casos de uso do portal da clínica parceira sobre `Examination` (D19/ADR-023 revisto 2026-11-04,
// BR-CLN-03/07/08, endpoints.md `/clinic-portal/exam-agenda/*` — tag "Clinic Portal"; não há
// pedidos a confirmar/recusar: o exame nasce `SCHEDULED` por marcação direta da família). Autenticados pelo ator de clínica
// (`ClinicPortalActor`, ADR-020) — nunca `AccessPolicy`/`User` (authorization.md §6.1: a verificação
// é "clínica do token = clínica do exame", feita por `findByClinicId`/`listByClinicAndStatus`).
// Devolve sempre `ClinicExamView` (BR-CLN-03: nome do paciente, tipo de exame, data/hora,
// observações do pedido, motivo da clínica — nunca o `Examination` completo, nunca os VALORES dos
// resultados nem o conteúdo de documentos).
import { ConflictError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertHasValue, assertValidParameter, assertValidReferenceRange } from "../domain/exam-result.js";
import { assertValidClinicCompletion, assertValidExaminationTransition, MAX_CLINIC_RESULTS, type Examination, type ExaminationStatus } from "../domain/examination.js";
import type { AddExamResultInput } from "./add-exam-result.js";
import type { ClinicPortalActor, ExaminationsDeps, NewExamResultRecord, RequestContext } from "./ports.js";

export interface ClinicExamDocumentView {
  id: string;
  originalName: string;
  sizeBytes: number;
  scanStatus: "PENDING" | "CLEAN" | "INFECTED";
  createdAt: string;
}

export interface ClinicExamView {
  id: string;
  status: ExaminationStatus;
  scheduledAt: string;
  examType?: string;
  patientName: string;
  notes?: string;
  responseNote?: string;
  resultsCount: number;
  documents: ClinicExamDocumentView[];
  resultsIssuedAt?: string;
  /** M14 R (BR-CLN-31): recibo `ISSUED` do exame; nunca devolvido ao Médico (BR-CLN-39). */
  receiptId?: string;
}

/**
 * BR-CLN-39: o Médico só vê/age em exames cujo horário (`clinic_slots.professional_id`) é o seu profissional;
 * Admin/Gestor (sem `professionalId`) veem tudo. Exame sem horário nunca é de um Médico.
 */
async function actorOwnsExam<Trx>(deps: ExaminationsDeps<Trx>, actor: ClinicPortalActor, examination: Examination): Promise<boolean> {
  if (!actor.professionalId) return true;
  if (!examination.slotId) return false;
  return (await deps.clinics.findSlotById(examination.slotId))?.professionalId === actor.professionalId;
}

async function withReceiptIds<Trx>(deps: ExaminationsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, views: ClinicExamView[]): Promise<ClinicExamView[]> {
  const completed = views.filter((v) => v.status === "COMPLETED");
  if (actor.professionalId || completed.length === 0) return views;
  const ids = await deps.receipts.findIssuedReceiptIds(trx, actor.clinicId, "EXAM", completed.map((v) => v.id));
  return views.map((v) => {
    const receiptId = ids.get(v.id);
    return receiptId ? { ...v, receiptId } : v;
  });
}

async function toView<Trx>(deps: ExaminationsDeps<Trx>, trx: Trx, examination: Examination): Promise<ClinicExamView> {
  const patientName = (await deps.memberNames.getMemberName(trx, examination.familyId, examination.memberId)) ?? "Membro da família";
  // BR-CLN-08: a clínica só vê o que ela própria emitiu (contagem, nunca valores; metadados dos seus PDF).
  const resultsCount = examination.issuedBy === "CLINIC" ? (await deps.examResultsRepo.listByExamination(trx, examination.id)).length : 0;
  const documents = (await deps.documents.listForResource(trx, examination.familyId, examination.memberId, "EXAMINATION", examination.id))
    .filter((document) => document.uploadedByClinic)
    .map((document) => ({
      id: document.id,
      originalName: document.originalName,
      sizeBytes: document.sizeBytes,
      scanStatus: document.scanStatus,
      createdAt: document.createdAt.toISOString(),
    }));
  return {
    id: examination.id,
    status: examination.status,
    // `findByClinicId`/`listByClinicAndStatus` só devolvem exames com `scheduled_at` (nascidos de um horário).
    scheduledAt: (examination.scheduledAt ?? examination.createdAt).toISOString(),
    patientName,
    resultsCount,
    documents,
    ...(examination.name ? { examType: examination.name } : {}),
    ...(examination.notes ? { notes: examination.notes } : {}),
    ...(examination.responseNote ? { responseNote: examination.responseNote } : {}),
    ...(examination.resultsIssuedAt ? { resultsIssuedAt: examination.resultsIssuedAt.toISOString() } : {}),
  };
}

async function requireOwnExam<Trx>(deps: ExaminationsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, examinationId: string): Promise<Examination> {
  const examination = await deps.examinationsRepo.findByClinicId(trx, actor.clinicId, examinationId);
  if (!examination) {
    throw new NotFoundError({ detail: "Exame não encontrado." });
  }
  return examination;
}

/** audit.md §3 (D19): portal sem `family_id`/`subject_member_id`; `metadata` nunca com resultados/motivos. */
function clinicAudit(actor: ClinicPortalActor, now: Date, action: "EXAM_CLINIC_CANCEL" | "EXAM_CLINIC_COMPLETE", examinationId: string, context: RequestContext, metadata: Record<string, string | number | boolean | null>) {
  return {
    occurredAt: now,
    actorType: "CLINIC_ACCOUNT" as const,
    actorClinicAccountId: actor.clinicAccountId,
    action,
    resourceType: "Examination",
    resourceId: examinationId,
    result: "SUCCESS" as const,
    requestId: context.requestId,
    ...auditContextFields(context),
    metadata,
  };
}

export interface ListClinicExamAgendaQuery {
  from?: Date;
  to?: Date;
}

const AGENDA_STATUSES: ExaminationStatus[] = ["SCHEDULED", "COMPLETED", "CANCELLED"];

/** `GET /clinic-portal/exam-agenda` (UC-CLN-09): marcações (e os seus desfechos) da própria clínica. */
export function createListClinicExamAgendaUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function listClinicExamAgenda(actor: ClinicPortalActor, query: ListClinicExamAgendaQuery): Promise<ClinicExamView[]> {
    return deps.withTransaction(async (trx) => {
      const exams = await deps.examinationsRepo.listByClinicAndStatus(trx, actor.clinicId, AGENDA_STATUSES, query);
      const own: Examination[] = [];
      for (const exam of exams) {
        if (await actorOwnsExam(deps, actor, exam)) own.push(exam);
      }
      return withReceiptIds(deps, trx, actor, await Promise.all(own.map((exam) => toView(deps, trx, exam))));
    });
  };
}

export interface CancelClinicExaminationInput {
  note: string;
}

/** `PUT /clinic-portal/exam-agenda/{examinationId}/cancel` (UC-CLN-09): cancelar um exame confirmado e
 * futuro da própria clínica, com motivo obrigatório; horário livre; avisa a família. */
export function createCancelClinicExaminationUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function cancelClinicExamination(actor: ClinicPortalActor, examinationId: string, input: CancelClinicExaminationInput, context: RequestContext): Promise<ClinicExamView> {
    const note = input.note.trim();
    if (!note) {
      throw new ValidationError([{ field: "note", message: "obrigatório" }], { detail: "Motivo obrigatório para cancelar." });
    }

    return deps.withTransaction(async (trx) => {
      const existing = await requireOwnExam(deps, trx, actor, examinationId);
      const now = deps.clock.now();
      if (existing.status !== "SCHEDULED" || (existing.scheduledAt?.getTime() ?? 0) <= now.getTime()) {
        throw new ConflictError({ detail: "Só exames confirmados e futuros podem ser cancelados pela clínica." });
      }
      assertValidExaminationTransition(existing.status, "CANCELLED");

      const examination = await deps.examinationsRepo.updateStatusByClinic(trx, examinationId, { status: "CANCELLED", responseNote: note });

      await deps.audit.record(trx, clinicAudit(actor, now, "EXAM_CLINIC_CANCEL", examinationId, context, { from: existing.status, to: "CANCELLED" }));
      await deps.alerts.raiseExamEvent(trx, { type: "EXAM_CANCELLED", examinationId, familyId: existing.familyId, memberId: existing.memberId });

      return toView(deps, trx, examination);
    });
  };
}

export interface CompleteClinicExaminationInput {
  results?: AddExamResultInput[] | null;
  resultNote?: string | null;
}

/**
 * `PUT /clinic-portal/exam-agenda/{examinationId}/complete` (UC-CLN-10, BR-CLN-08): `SCHEDULED ->
 * COMPLETED` e resultados estruturados gravados na MESMA transação (tudo ou nada). Sem
 * interpretação nem alertas por valor (D11, BR-EXM-02): o único alerta é o genérico
 * `EXAM_RESULTS_AVAILABLE`. Pelo menos um parâmetro ou um PDF já carregado.
 */
export function createCompleteClinicExaminationUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function completeClinicExamination(actor: ClinicPortalActor, examinationId: string, input: CompleteClinicExaminationInput, context: RequestContext): Promise<ClinicExamView> {
    const items = input.results ?? [];
    if (items.length > MAX_CLINIC_RESULTS) {
      assertValidClinicCompletion({ resultsCount: items.length, documentsCount: 0 });
    }
    const resultNote = input.resultNote?.trim() ? input.resultNote.trim() : null;
    // Validação pura de cada parâmetro antes de abrir a transação (mesmas regras de `addExamResult`).
    const validated = items.map((item) => {
      const parameter = assertValidParameter(item.parameter);
      assertHasValue(item.valueNumeric ?? undefined, item.valueText ?? undefined);
      assertValidReferenceRange(item.referenceMin ?? undefined, item.referenceMax ?? undefined);
      return { item, parameter };
    });

    return deps.withTransaction(async (trx) => {
      const existing = await requireOwnExam(deps, trx, actor, examinationId);
      if (!(await actorOwnsExam(deps, actor, existing))) {
        throw new NotFoundError({ detail: "Exame não encontrado." });
      }
      // endpoints.md (completeClinicExamination): CONFLICT se o exame não está SCHEDULED.
      if (existing.status !== "SCHEDULED") {
        throw new ConflictError({ detail: "Só o exame confirmado (SCHEDULED) pode ser completado." });
      }
      const clinicDocuments = (await deps.documents.listForResource(trx, existing.familyId, existing.memberId, "EXAMINATION", examinationId)).filter((d) => d.uploadedByClinic);
      assertValidClinicCompletion({ resultsCount: validated.length, documentsCount: clinicDocuments.length, resultNote });
      assertValidExaminationTransition(existing.status, "COMPLETED");

      const now = deps.clock.now();
      for (const { item, parameter } of validated) {
        const record: NewExamResultRecord = {
          id: newId(),
          examinationId,
          parameter,
          createdAt: now,
          ...(item.valueNumeric !== undefined && item.valueNumeric !== null ? { valueNumeric: item.valueNumeric } : {}),
          ...(item.valueText !== undefined && item.valueText !== null ? { valueText: item.valueText } : {}),
          ...(item.unit !== undefined && item.unit !== null ? { unit: item.unit } : {}),
          ...(item.referenceMin !== undefined && item.referenceMin !== null ? { referenceMin: item.referenceMin } : {}),
          ...(item.referenceMax !== undefined && item.referenceMax !== null ? { referenceMax: item.referenceMax } : {}),
        };
        await deps.examResultsRepo.insert(trx, record);
      }
      const examination = await deps.examinationsRepo.completeByClinic(trx, examinationId, { clinicAccountId: actor.clinicAccountId, issuedAt: now, resultNote });

      await deps.audit.record(trx, clinicAudit(actor, now, "EXAM_CLINIC_COMPLETE", examinationId, context, { from: existing.status, to: "COMPLETED", resultsCount: validated.length, documentsCount: clinicDocuments.length }));
      await deps.alerts.raiseExamEvent(trx, { type: "EXAM_RESULTS_AVAILABLE", examinationId, familyId: existing.familyId, memberId: existing.memberId });

      return toView(deps, trx, examination);
    });
  };
}

export interface UploadClinicExamDocumentInput {
  file: { buffer: Buffer; originalName: string };
}

/** Resolve (dentro da transação de `documents`) o alvo do upload/remoção: exame da própria clínica em `SCHEDULED`. */
function scheduledExamResolver<Trx>(deps: ExaminationsDeps<Trx>, actor: ClinicPortalActor, examinationId: string) {
  return async (trx: Trx): Promise<{ familyId: string; memberId: string }> => {
    const examination = await requireOwnExam(deps, trx, actor, examinationId);
    if (!(await actorOwnsExam(deps, actor, examination))) {
      throw new NotFoundError({ detail: "Exame não encontrado." });
    }
    if (examination.status !== "SCHEDULED") {
      throw new ConflictError({ detail: "Só é possível alterar PDF de um exame confirmado (SCHEDULED)." });
    }
    return { familyId: examination.familyId, memberId: examination.memberId };
  };
}

/** `POST /clinic-portal/exam-agenda/{examinationId}/documents` (BR-CLN-08): só PDF, quarentena + ClamAV;
 * devolve só metadados — a clínica nunca descarrega. */
export function createUploadClinicExamDocumentUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function uploadClinicExamDocument(actor: ClinicPortalActor, examinationId: string, input: UploadClinicExamDocumentInput, context: RequestContext): Promise<ClinicExamDocumentView> {
    const document = await deps.documents.uploadClinicExamDocument(
      { clinicAccountId: actor.clinicAccountId },
      { examinationId, file: input.file },
      scheduledExamResolver(deps, actor, examinationId),
      context,
    );
    return { id: document.id, originalName: document.originalName, sizeBytes: document.sizeBytes, scanStatus: document.scanStatus, createdAt: document.createdAt.toISOString() };
  };
}

/** `DELETE /clinic-portal/exam-agenda/{examinationId}/documents/{documentId}` (BR-CLN-08): só os PDF
 * carregados pela clínica, enquanto o exame está `SCHEDULED`. */
export function createDeleteClinicExamDocumentUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function deleteClinicExamDocument(actor: ClinicPortalActor, examinationId: string, documentId: string, context: RequestContext): Promise<void> {
    await deps.documents.deleteClinicExamDocument({ clinicAccountId: actor.clinicAccountId }, { examinationId, documentId }, scheduledExamResolver(deps, actor, examinationId), context);
  };
}
