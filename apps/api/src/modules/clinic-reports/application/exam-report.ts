// Gerador do laudo de exame (BR-CLN-48/49, M15 T, ADR-027): implementa a porta `ExamReportGenerator` de `examinations`
// (ligada em `main/api.ts`). Monta o documento a partir de texto já validado e delega o desenho em `PdfRenderer`.
import { DomainError } from "../../../platform/errors/index.js";
import { buildExamReportDocument, type ExamReportResult } from "../domain/exam-report-pdf.js";
import { MAX_GENERATED_PDF_BYTES } from "../domain/pdf-document.js";
import type { ClinicReportsDeps } from "./ports.js";

export interface ExamReportRequest {
  clinicId: string;
  slotId?: string;
  patientName: string;
  examName: string;
  /** `AAAA-MM-DD`. */
  examDate: string;
  results: ExamReportResult[];
  resultNote: string | null;
}

export interface GeneratedExamReport {
  bytes: Buffer;
  resultsCount: number;
  /** Contagem aritmética (nunca quais) para a auditoria. */
  outOfReferenceCount: number;
}

export function createExamReportGeneratorUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function generateExamReport(trx: Trx, request: ExamReportRequest): Promise<GeneratedExamReport> {
    const { issuer } = await deps.profile.get(trx, request.clinicId);
    const professional = request.slotId ? await deps.professionals.professionalOfSlot(trx, request.clinicId, request.slotId) : null;
    const build = buildExamReportDocument({
      issuer,
      patientName: request.patientName,
      examName: request.examName,
      examDate: request.examDate,
      results: request.results,
      resultNote: request.resultNote,
      ...(professional?.name ? { professionalName: professional.name } : {}),
      issuedAt: deps.clock.now(),
    });
    const bytes = await deps.pdf.render(build.document);
    if (bytes.length > MAX_GENERATED_PDF_BYTES) {
      throw new DomainError("INTERNAL_ERROR", { detail: "O laudo gerado excede o tamanho máximo." });
    }
    return { bytes, resultsCount: build.resultsCount, outOfReferenceCount: build.outOfReferenceCount };
  };
}
