// Casos de uso do portal da clínica parceira sobre `Examination` (D19/ADR-023 revisto 2026-11-04,
// BR-CLN-03/07/08, endpoints.md `/clinic-portal/exam-agenda/*` — tag "Clinic Portal"; não há
// pedidos a confirmar/recusar: o exame nasce `SCHEDULED` por marcação direta da família). Autenticados pelo ator de clínica
// (`ClinicPortalActor`, ADR-020) — nunca `AccessPolicy`/`User` (authorization.md §6.1: a verificação
// é "clínica do token = clínica do exame", feita por `findByClinicId`/`listByClinicAndStatus`).
// Devolve sempre `ClinicExamView` (BR-CLN-03: nome do paciente, tipo de exame, data/hora,
// observações do pedido, motivo da clínica — nunca o `Examination` completo, nunca os VALORES dos
// resultados nem o conteúdo de documentos).
import { ConflictError, DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertHasValue, assertValidParameter, assertValidReferenceRange } from "../domain/exam-result.js";
import { assertValidClinicCompletion, assertValidExaminationTransition, MAX_CLINIC_RESULTS, type Examination, type ExaminationStatus } from "../domain/examination.js";
import type { AddExamResultInput } from "./add-exam-result.js";
import type { ClinicPortalActor, ExamResultDraftItem, ExaminationsDeps, NewExamResultRecord, RequestContext } from "./ports.js";

export interface ClinicExamDocumentView {
  id: string;
  originalName: string;
  sizeBytes: number;
  scanStatus: "PENDING" | "CLEAN" | "INFECTED";
  /** M15 T (BR-CLN-49): laudo gerado pelo sistema (a clínica pode descarregá-lo); false = PDF carregado (só metadados). */
  generatedBySystem: boolean;
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
  /** M15 T (BR-CLN-47): existe rascunho de resultados (exame `SCHEDULED`). */
  hasResultsDraft: boolean;
  /** M15 T (BR-CLN-49): existe laudo PDF gerado e descarregável em `…/report/pdf`. */
  reportAvailable: boolean;
}

/**
 * BR-CLN-39: o Médico só vê/age em exames cujo horário (`clinic_slots.professional_id`) é o seu profissional;
 * Admin/Gestor (sem `professionalId`) veem tudo. Exame sem horário nunca é de um Médico.
 */
export async function actorOwnsExam<Trx>(deps: ExaminationsDeps<Trx>, actor: ClinicPortalActor, examination: Examination): Promise<boolean> {
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
      generatedBySystem: document.generatedBySystem,
      createdAt: document.createdAt.toISOString(),
    }));
  const hasResultsDraft = examination.status === "SCHEDULED" && (await deps.draftsRepo.existingIds(trx, [examination.id])).has(examination.id);
  return {
    hasResultsDraft,
    reportAvailable: examination.status === "COMPLETED" && documents.some((d) => d.generatedBySystem),
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

export async function requireOwnExam<Trx>(deps: ExaminationsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, examinationId: string): Promise<Examination> {
  const examination = await deps.examinationsRepo.findByClinicId(trx, actor.clinicId, examinationId);
  if (!examination) {
    throw new NotFoundError({ detail: "Exame não encontrado." });
  }
  return examination;
}

/** audit.md §3 (D19): portal sem `family_id`/`subject_member_id`; `metadata` nunca com resultados/motivos. */
export function clinicAudit(
  actor: ClinicPortalActor,
  now: Date,
  action: "EXAM_CLINIC_CANCEL" | "EXAM_CLINIC_COMPLETE" | "EXAM_RESULTS_DRAFT_SAVED" | "EXAM_RESULTS_DRAFT_DISCARDED" | "EXAM_REPORT_GENERATED" | "EXAM_REPORT_DOWNLOAD",
  examinationId: string,
  context: RequestContext,
  metadata: Record<string, string | number | boolean | null>,
) {
  return {
    occurredAt: now,
    actorType: "CLINIC_ACCOUNT" as const,
    actorClinicAccountId: actor.clinicAccountId,
    actorClinicId: actor.clinicId,
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
      // M15 T (BR-CLN-47): o rascunho de resultados apaga-se ao cancelar o exame.
      await deps.draftsRepo.delete(trx, examinationId);

      await deps.audit.record(trx, clinicAudit(actor, now, "EXAM_CLINIC_CANCEL", examinationId, context, { from: existing.status, to: "CANCELLED" }));
      await deps.alerts.raiseExamEvent(trx, { type: "EXAM_CANCELLED", examinationId, familyId: existing.familyId, memberId: existing.memberId });

      return toView(deps, trx, examination);
    });
  };
}

export interface CompleteClinicExaminationInput {
  /** `undefined` (omitido) usa o rascunho, se existir (BR-CLN-47); `[]` explícito usa o pedido. */
  results?: AddExamResultInput[] | null;
  resultNote?: string | null;
  /** M15 T (BR-CLN-48): omissão `true`. */
  generateReport?: boolean;
}

export interface ValidatedResultItem {
  item: ExamResultDraftItem;
  parameter: string;
}

/** Validação pura de cada parâmetro (mesmas regras de `addExamResult`, BR-CLN-08) — partilhada com o rascunho (BR-CLN-47). */
export function validateResultItems(items: ExamResultDraftItem[]): ValidatedResultItem[] {
  if (items.length > MAX_CLINIC_RESULTS) {
    assertValidClinicCompletion({ resultsCount: items.length, documentsCount: 0 });
  }
  return items.map((item) => {
    const parameter = assertValidParameter(item.parameter);
    assertHasValue(item.valueNumeric ?? undefined, item.valueText ?? undefined);
    assertValidReferenceRange(item.referenceMin ?? undefined, item.referenceMax ?? undefined);
    return { item, parameter };
  });
}

/**
 * `PUT /clinic-portal/exam-agenda/{examinationId}/complete` (UC-CLN-10, BR-CLN-08): `SCHEDULED ->
 * COMPLETED` e resultados estruturados gravados na MESMA transação (tudo ou nada). Sem
 * interpretação nem alertas por valor (D11, BR-EXM-02): o único alerta é o genérico
 * `EXAM_RESULTS_AVAILABLE`. Pelo menos um parâmetro ou um PDF já carregado.
 * M15 T: sem `results` no corpo usa-se o rascunho (BR-CLN-47), que se apaga na conclusão; com ≥1 resultado gera-se o laudo
 * PDF (BR-CLN-48/49) na mesma transação — falha na geração => a conclusão falha sem efeitos (`generateReport=false` é a saída).
 */
export function createCompleteClinicExaminationUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function completeClinicExamination(actor: ClinicPortalActor, examinationId: string, input: CompleteClinicExaminationInput, context: RequestContext): Promise<ClinicExamView> {
    // Corpo explícito (mesmo `[]`) valida-se já; sem `results` só se conhece o rascunho dentro da transação.
    const explicit = input.results !== undefined && input.results !== null ? validateResultItems(input.results) : null;
    const requestNote = input.resultNote?.trim() ? input.resultNote.trim() : null;
    const stored: { key: string | null } = { key: null };

    try {
      return await deps.withTransaction(async (trx) => {
        const existing = await requireOwnExam(deps, trx, actor, examinationId);
        if (!(await actorOwnsExam(deps, actor, existing))) {
          throw new NotFoundError({ detail: "Exame não encontrado." });
        }
        // endpoints.md (completeClinicExamination): CONFLICT se o exame não está SCHEDULED.
        if (existing.status !== "SCHEDULED") {
          throw new ConflictError({ detail: "Só o exame confirmado (SCHEDULED) pode ser completado." });
        }
        const draft = explicit ? null : await deps.draftsRepo.find(trx, examinationId);
        const validated = explicit ?? (draft ? validateResultItems(draft.results) : []);
        const resultNote = requestNote ?? (explicit ? null : (draft?.resultNote ?? null));
        const clinicDocuments = (await deps.documents.listForResource(trx, existing.familyId, existing.memberId, "EXAMINATION", examinationId)).filter((d) => d.uploadedByClinic);
        assertValidClinicCompletion({ resultsCount: validated.length, documentsCount: clinicDocuments.length, resultNote });
        assertValidExaminationTransition(existing.status, "COMPLETED");

        const now = deps.clock.now();
        // BR-CLN-48/49: laudo PDF gerado pelo servidor, instantâneo do que foi emitido (não se recalcula). Gera-se ANTES de qualquer
        // escrita do exame: se a geração falha, a conclusão falha sem efeitos (`generateReport=false` é a saída).
        let generated: { documentId: string; resultsCount: number; outOfReferenceCount: number } | null = null;
        if (input.generateReport !== false && validated.length > 0) {
          const patientName = (await deps.memberNames.getMemberName(trx, existing.familyId, existing.memberId)) ?? "Paciente";
          let report: Awaited<ReturnType<typeof deps.reportGenerator.generate>>;
          try {
            report = await deps.reportGenerator.generate(trx, {
              clinicId: actor.clinicId,
              ...(existing.slotId ? { slotId: existing.slotId } : {}),
              patientName,
              examName: existing.name,
              examDate: existing.examDate,
              results: validated.map(({ item, parameter }) => ({ ...item, parameter })),
              resultNote,
            });
          } catch {
            throw new DomainError("INTERNAL_ERROR", { detail: "Não foi possível gerar o laudo; conclua sem laudo." });
          }
          const document = await deps.documents.storeGenerated(trx, {
            familyId: existing.familyId,
            memberId: existing.memberId,
            examinationId,
            originalName: `laudo-${existing.examDate.replaceAll("-", "")}.pdf`,
            bytes: report.bytes,
            clinicAccountId: actor.clinicAccountId,
          });
          stored.key = document.storageKey;
          generated = { documentId: document.id, resultsCount: report.resultsCount, outOfReferenceCount: report.outOfReferenceCount };
        }

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
        await deps.draftsRepo.delete(trx, examinationId);

        await deps.audit.record(trx, clinicAudit(actor, now, "EXAM_CLINIC_COMPLETE", examinationId, context, { from: existing.status, to: "COMPLETED", resultsCount: validated.length, documentsCount: clinicDocuments.length }));
        if (generated) {
          await deps.audit.record(trx, { ...clinicAudit(actor, now, "EXAM_REPORT_GENERATED", generated.documentId, context, { resultsCount: generated.resultsCount, outOfReferenceCount: generated.outOfReferenceCount }), resourceType: "Document" });
        }
        await deps.alerts.raiseExamEvent(trx, { type: "EXAM_RESULTS_AVAILABLE", examinationId, familyId: existing.familyId, memberId: existing.memberId });

        return toView(deps, trx, examination);
      });
    } catch (error) {
      // O objeto do laudo já estava escrito mas a transação reverteu: vai para a outbox `file_deletions` (modules.md nota 27).
      if (stored.key) await deps.documents.discardStored(stored.key);
      throw error;
    }
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
    return { id: document.id, originalName: document.originalName, sizeBytes: document.sizeBytes, scanStatus: document.scanStatus, generatedBySystem: document.generatedBySystem, createdAt: document.createdAt.toISOString() };
  };
}

/** `DELETE /clinic-portal/exam-agenda/{examinationId}/documents/{documentId}` (BR-CLN-08): só os PDF
 * carregados pela clínica, enquanto o exame está `SCHEDULED`. */
export function createDeleteClinicExamDocumentUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function deleteClinicExamDocument(actor: ClinicPortalActor, examinationId: string, documentId: string, context: RequestContext): Promise<void> {
    await deps.documents.deleteClinicExamDocument({ clinicAccountId: actor.clinicAccountId }, { examinationId, documentId }, scheduledExamResolver(deps, actor, examinationId), context);
  };
}
