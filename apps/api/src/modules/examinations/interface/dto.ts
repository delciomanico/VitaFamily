// Mapeamento de `ExaminationView`/`ExamResult`/`ExamResultHistoryItem` (application) -> forma da
// API (components.schemas.Examination/ExamResult/ExamResultHistoryItem, openapi.yaml).
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
    notes: examination.notes ?? null,
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
