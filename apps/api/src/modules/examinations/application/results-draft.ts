// Rascunho de resultados de exame e laudo gerado — casos de uso do portal da clínica (UC-CLN-37/38, BR-CLN-47..49, M15 T,
// ADR-027). Permissões = as de `complete` de exame (Admin, Gestor e Médico nos seus): é entrada de valores, não autoria
// clínica (authorization.md §6.2b). Os valores são dado de saúde: NUNCA em logs nem auditoria (só contagens).
import { DomainError, NotFoundError, RateLimitedError, ValidationError, type FieldError } from "../../../platform/errors/index.js";
import { MAX_CLINIC_RESULTS, MAX_CLINIC_RESULT_NOTE_LENGTH } from "../domain/examination.js";
import { actorOwnsExam, clinicAudit, requireOwnExam, validateResultItems } from "./clinic-examinations.js";
import type { ClinicPortalActor, ExamResultDraftItem, ExaminationsDeps, RequestContext } from "./ports.js";

const WRITE_LIMIT = { max: 60, windowMs: 60_000 };
const PDF_LIMIT = { max: 30, windowMs: 60_000 };

function consume<Trx>(deps: ExaminationsDeps<Trx>, kind: "draft-write" | "report-pdf", accountId: string): void {
  const decision = deps.limiter.consume(`exam-${kind}:${accountId}`, kind === "draft-write" ? WRITE_LIMIT : PDF_LIMIT);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs, { detail: "Demasiados pedidos; tente mais tarde." });
}

export interface ClinicExamResultsDraftView {
  examinationId: string;
  status: "DRAFT";
  results: ExamResultDraftItem[];
  resultNote: string | null;
  updatedAt: string;
}

function toDraftView(draft: { examinationId: string; results: ExamResultDraftItem[]; resultNote: string | null; updatedAt: Date }): ClinicExamResultsDraftView {
  return { examinationId: draft.examinationId, status: "DRAFT", results: draft.results, resultNote: draft.resultNote, updatedAt: draft.updatedAt.toISOString() };
}

async function requireScopedExam<Trx>(deps: ExaminationsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, examinationId: string) {
  const exam = await requireOwnExam(deps, trx, actor, examinationId);
  if (!(await actorOwnsExam(deps, actor, exam))) throw new NotFoundError({ detail: "Exame não encontrado." });
  return exam;
}

/** `ClinicExamResultsDraftInput`: `results` (0–50 `ExamResultInput`) e `resultNote` (≤2000); ≥1 resultado ou a nota. */
function parseDraftInput(body: unknown): { results: ExamResultDraftItem[]; resultNote: string | null } {
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!record) throw new ValidationError([{ field: "results", message: "objeto esperado" }], { detail: "Rascunho inválido." });
  const errors: FieldError[] = [];
  for (const key of Object.keys(record)) if (key !== "results" && key !== "resultNote") errors.push({ field: key, message: "campo desconhecido" });
  const results = record.results ?? [];
  if (!Array.isArray(results)) errors.push({ field: "results", message: "lista esperada" });
  else if (results.length > MAX_CLINIC_RESULTS) errors.push({ field: "results", message: `no máximo ${String(MAX_CLINIC_RESULTS)} parâmetros` });
  const rawNote = record.resultNote;
  let resultNote: string | null = null;
  if (rawNote !== undefined && rawNote !== null) {
    if (typeof rawNote !== "string") errors.push({ field: "resultNote", message: "texto esperado" });
    else if (rawNote.trim().length > MAX_CLINIC_RESULT_NOTE_LENGTH) errors.push({ field: "resultNote", message: `no máximo ${String(MAX_CLINIC_RESULT_NOTE_LENGTH)} caracteres` });
    else resultNote = rawNote.trim() === "" ? null : rawNote.trim();
  }
  if (errors.length > 0) throw new ValidationError(errors, { detail: "Rascunho inválido." });
  const items = results as ExamResultDraftItem[];
  const validated = validateResultItems(items);
  if (validated.length === 0 && resultNote === null) {
    throw new ValidationError([{ field: "results", message: "indique pelo menos um resultado ou a nota" }], { detail: "Rascunho vazio." });
  }
  return { results: validated.map(({ item, parameter }) => ({ ...item, parameter })), resultNote };
}

/** `GET /clinic-portal/exam-agenda/{id}/results-draft`. Sem rascunho => `NOT_FOUND`. */
export function createGetResultsDraftUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function getResultsDraft(actor: ClinicPortalActor, examinationId: string): Promise<ClinicExamResultsDraftView> {
    return deps.withTransaction(async (trx) => {
      await requireScopedExam(deps, trx, actor, examinationId);
      const draft = await deps.draftsRepo.find(trx, examinationId);
      if (!draft) throw new NotFoundError({ detail: "Rascunho não encontrado." });
      return toDraftView(draft);
    });
  };
}

/** `PUT …/results-draft`: guarda (substitui) o rascunho SEM concluir; o exame fica `SCHEDULED` e o paciente não vê nada. */
export function createSaveResultsDraftUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function saveResultsDraft(actor: ClinicPortalActor, examinationId: string, body: unknown, context: RequestContext): Promise<ClinicExamResultsDraftView> {
    consume(deps, "draft-write", actor.clinicAccountId);
    const input = parseDraftInput(body);
    return deps.withTransaction(async (trx) => {
      const exam = await requireScopedExam(deps, trx, actor, examinationId);
      if (exam.status !== "SCHEDULED") throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Só o exame confirmado (SCHEDULED) admite rascunho." });
      const now = deps.clock.now();
      const draft = await deps.draftsRepo.upsert(trx, { examinationId, results: input.results, resultNote: input.resultNote, clinicAccountId: actor.clinicAccountId, now });
      await deps.audit.record(trx, clinicAudit(actor, now, "EXAM_RESULTS_DRAFT_SAVED", examinationId, context, { resultsCount: input.results.length }));
      return toDraftView(draft);
    });
  };
}

/** `DELETE …/results-draft`: idempotente (sem rascunho => 204). */
export function createDiscardResultsDraftUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function discardResultsDraft(actor: ClinicPortalActor, examinationId: string, context: RequestContext): Promise<void> {
    consume(deps, "draft-write", actor.clinicAccountId);
    await deps.withTransaction(async (trx) => {
      await requireScopedExam(deps, trx, actor, examinationId);
      const draft = await deps.draftsRepo.find(trx, examinationId);
      if (!draft) return;
      await deps.draftsRepo.delete(trx, examinationId);
      await deps.audit.record(trx, clinicAudit(actor, deps.clock.now(), "EXAM_RESULTS_DRAFT_DISCARDED", examinationId, context, { resultsCount: draft.results.length }));
    });
  };
}

export interface ExamReportDownload {
  bytes: Buffer;
  filename: string;
}

/** `GET …/report/pdf` (BR-CLN-49): a clínica descarrega SÓ o laudo que o sistema gerou; exame não `COMPLETED`, sem laudo ou apagado => `NOT_FOUND`. */
export function createDownloadExamReportUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function downloadExamReport(actor: ClinicPortalActor, examinationId: string, context: RequestContext): Promise<ExamReportDownload> {
    consume(deps, "report-pdf", actor.clinicAccountId);
    return deps.withTransaction(async (trx) => {
      const exam = await requireScopedExam(deps, trx, actor, examinationId);
      if (exam.status !== "COMPLETED") throw new NotFoundError({ detail: "Laudo não encontrado." });
      const generated = await deps.documents.readGeneratedExamReport(trx, exam.familyId, exam.memberId, examinationId);
      if (!generated) throw new NotFoundError({ detail: "Laudo não encontrado." });
      await deps.audit.record(trx, { ...clinicAudit(actor, deps.clock.now(), "EXAM_REPORT_DOWNLOAD", generated.document.id, context, { examinationId }), resourceType: "Document" });
      return { bytes: generated.bytes, filename: `laudo-${exam.examDate.replaceAll("-", "")}.pdf` };
    });
  };
}
