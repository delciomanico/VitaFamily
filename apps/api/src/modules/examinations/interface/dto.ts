// Mapeamento de `ExaminationView`/`ExamResult`/`ExamResultHistoryItem` (application) -> forma da
// API (components.schemas.Examination/ExamResult/ExamResultHistoryItem, openapi.yaml).
import type { ClinicExamView } from "../application/clinic-examinations.js";
import type { ExamResultHistoryItem } from "../application/ports.js";
import type { ExaminationView } from "../application/examination-view.js";
import type { ExamResult } from "../domain/exam-result.js";

export function toExamResultResponse(result: ExamResult) {
  return {
    id: result.id,
    parameter: result.parameter,
    valueNumeric: result.valueNumeric ?? null,
    valueText: result.valueText ?? null,
    unit: result.unit ?? null,
    referenceMin: result.referenceMin ?? null,
    referenceMax: result.referenceMax ?? null,
    createdAt: result.createdAt.toISOString(),
  };
}

export function toExaminationResponse(examination: ExaminationView) {
  return {
    id: examination.id,
    memberId: examination.memberId,
    name: examination.name,
    examDate: examination.examDate,
    status: examination.status,
    clinicId: examination.clinicId ?? null,
    clinicName: examination.clinicName ?? null,
    scheduledAt: examination.scheduledAt?.toISOString() ?? null,
    slotId: examination.slotId ?? null,
    responseNote: examination.responseNote ?? null,
    notes: examination.notes ?? null,
    issuedBy: examination.issuedBy,
    issuedByClinicAccountId: examination.issuedByClinicAccountId ?? null,
    resultsIssuedAt: examination.resultsIssuedAt?.toISOString() ?? null,
    clinicResultNote: examination.clinicResultNote ?? null,
    results: examination.results.map(toExamResultResponse),
    documentIds: examination.documentIds,
  };
}

export function toExaminationPage(page: { items: ExaminationView[]; nextCursor: string | null }) {
  return { items: page.items.map(toExaminationResponse), nextCursor: page.nextCursor };
}

export function toExamResultHistoryResponse(items: ExamResultHistoryItem[]) {
  return items.map((item) => ({
    examinationId: item.examinationId,
    examDate: item.examDate,
    valueNumeric: item.valueNumeric ?? null,
    valueText: item.valueText ?? null,
    unit: item.unit ?? null,
    referenceMin: item.referenceMin ?? null,
    referenceMax: item.referenceMax ?? null,
  }));
}

/** `components.schemas.ClinicExamBooking` (openapi.yaml, D19/BR-CLN-03): mínimo necessário, nunca o `Examination` completo. */
export function toClinicExamResponse(view: ClinicExamView) {
  return {
    id: view.id,
    status: view.status,
    scheduledAt: view.scheduledAt,
    examType: view.examType ?? null,
    patientName: view.patientName,
    notes: view.notes ?? null,
    responseNote: view.responseNote ?? null,
    resultsCount: view.resultsCount,
    documents: view.documents,
    resultsIssuedAt: view.resultsIssuedAt ?? null,
    receiptId: view.receiptId ?? null,
  };
}

export function toClinicExamListResponse(views: ClinicExamView[]) {
  return views.map(toClinicExamResponse);
}
