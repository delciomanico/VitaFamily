// Montagem pura do PDF do laudo de exame (BR-CLN-48, ADR-027) e do realce aritmético "Fora da referência" (emenda estreita a
// BR-EXM-02/D11): comparação ESTRITA do valor numérico com os limites indicados pela clínica; igual ao limite = dentro. Não é
// interpretação clínica: único rótulo, sem setas, cores nem gravidade. O realce só existe neste PDF.
import type { ReportIssuer } from "./consultation-report.js";
import type { PdfBlock, PdfDocument } from "./pdf-document.js";
import { formatIsoDate, formatLocalDateTime, issuerHeader } from "./report-pdf.js";

export const OUT_OF_REFERENCE_LABEL = "Fora da referência";
export const EXAM_REPORT_DISCLAIMER = "A indicação «Fora da referência» resulta apenas da comparação aritmética do valor com os limites de referência indicados pela clínica; não constitui interpretação clínica nem diagnóstico.";
export const EXAM_REPORT_FOOTER = "Documento não fiscal. Não substitui receita médica nem atestado.";

export interface ExamReportResult {
  parameter: string;
  valueNumeric?: number | null;
  valueText?: string | null;
  unit?: string | null;
  referenceMin?: number | null;
  referenceMax?: number | null;
}

/** `valor < min || valor > max`; só para valor numérico e pelo menos um limite. */
export function isOutOfReference(result: Pick<ExamReportResult, "valueNumeric" | "referenceMin" | "referenceMax">): boolean {
  const value = result.valueNumeric;
  if (value === undefined || value === null) return false;
  const { referenceMin: min, referenceMax: max } = result;
  if (min !== undefined && min !== null && value < min) return true;
  if (max !== undefined && max !== null && value > max) return true;
  return false;
}

export function formatReference(result: Pick<ExamReportResult, "referenceMin" | "referenceMax">): string {
  const { referenceMin: min, referenceMax: max } = result;
  const hasMin = min !== undefined && min !== null;
  const hasMax = max !== undefined && max !== null;
  if (hasMin && hasMax) return `${String(min)} – ${String(max)}`;
  if (hasMin) return `≥ ${String(min)}`;
  if (hasMax) return `≤ ${String(max)}`;
  return "—";
}

export interface ExamReportInput {
  issuer: ReportIssuer;
  patientName: string;
  examName: string;
  /** `AAAA-MM-DD`. */
  examDate: string;
  results: ExamReportResult[];
  resultNote: string | null;
  professionalName?: string;
  issuedAt: Date;
}

export interface ExamReportBuild {
  document: PdfDocument;
  resultsCount: number;
  /** Contagem aritmética (nunca quais) para a auditoria. */
  outOfReferenceCount: number;
}

export function buildExamReportDocument(input: ExamReportInput): ExamReportBuild {
  const structured = input.results.filter((r) => r.valueNumeric !== undefined && r.valueNumeric !== null);
  const textOnly = input.results.filter((r) => r.valueNumeric === undefined || r.valueNumeric === null);
  const outOfReferenceCount = structured.filter(isOutOfReference).length;
  const blocks: PdfBlock[] = [
    { kind: "paragraph", text: `Paciente: ${input.patientName}` },
    { kind: "paragraph", text: `Exame: ${input.examName} · ${formatIsoDate(input.examDate)}` },
    { kind: "spacer" },
  ];
  if (structured.length > 0) {
    blocks.push({
      kind: "table",
      columns: [
        { title: "Parâmetro", width: 0.3 },
        { title: "Valor", width: 0.16 },
        { title: "Unidade", width: 0.14 },
        { title: "Referência", width: 0.2 },
        { title: "Indicação", width: 0.2 },
      ],
      rows: structured.map((r) => ({ cells: [r.parameter, String(r.valueNumeric), r.unit ?? "", formatReference(r), isOutOfReference(r) ? OUT_OF_REFERENCE_LABEL : ""], highlightLastCell: isOutOfReference(r) })),
    });
    blocks.push({ kind: "paragraph", text: EXAM_REPORT_DISCLAIMER, muted: true });
  }
  if (textOnly.length > 0) {
    blocks.push({ kind: "heading", text: "Outros resultados" });
    for (const r of textOnly) {
      blocks.push({ kind: "paragraph", text: `${r.parameter}: ${r.valueText ?? ""}${r.unit ? ` ${r.unit}` : ""}` });
    }
  }
  if (input.resultNote) blocks.push({ kind: "section", title: "Nota", body: input.resultNote });
  blocks.push({ kind: "spacer" });
  if (input.professionalName) blocks.push({ kind: "paragraph", text: `Profissional: ${input.professionalName}` });
  blocks.push({ kind: "paragraph", text: `Emitido em ${formatLocalDateTime(input.issuedAt)}` });
  return {
    document: { header: issuerHeader(input.issuer), title: "Laudo de exame", blocks, footer: EXAM_REPORT_FOOTER, generatedAt: input.issuedAt },
    resultsCount: input.results.length,
    outOfReferenceCount,
  };
}
