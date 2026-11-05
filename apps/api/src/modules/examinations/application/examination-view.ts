// Vista composta `Examination` + `results` + `documentIds` (components.schemas.Examination,
// openapi.yaml) — mesmo critério de `prescriptions/application/prescription-view.ts`.
import type { Examination, ExaminationsDeps, ExamResult } from "./ports.js";

export interface ExaminationView extends Examination {
  results: ExamResult[];
  documentIds: string[];
}

export async function buildExaminationView<Trx>(deps: ExaminationsDeps<Trx>, trx: Trx, examination: Examination): Promise<ExaminationView> {
  const [results, documents] = await Promise.all([
    deps.examResultsRepo.listByExamination(trx, examination.id),
    deps.documents.listForResource(trx, examination.familyId, examination.memberId, "EXAMINATION", examination.id),
  ]);
  // BR-CLN-08 (D19): PDF emitido pela clínica só aparece ao paciente com o exame COMPLETED.
  const visible = documents.filter((d) => !d.uploadedByClinic || examination.status === "COMPLETED");
  return { ...examination, results, documentIds: visible.map((d) => d.id) };
}
