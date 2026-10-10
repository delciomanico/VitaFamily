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
  return { ...examination, results, documentIds: documents.map((d) => d.id) };
}
