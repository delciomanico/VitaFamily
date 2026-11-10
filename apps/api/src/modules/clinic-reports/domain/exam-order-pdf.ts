// Montagem pura dos PDF "Pedido de exame" (BR-CLN-54) e "Declaração de presença" (BR-CLN-55) — ADR-028. Só texto simples: sem
// HTML, ligações, scripts, imagens nem formulários (mesmo `PdfRenderer` e as mesmas verificações de conteúdo de BR-CLN-46).
import { localDateIso } from "../../../platform/time/index.js";
import type { ReportIssuer } from "./consultation-report.js";
import { ATTENDANCE_NOTICE, EXAM_ORDER_NOTICE, type ExamOrder } from "./exam-order.js";
import type { PdfBlock, PdfDocument } from "./pdf-document.js";
import { formatIsoDate, formatLocalDateTime, issuerHeader } from "./report-pdf.js";

/** `pedido-exame-AAAAMMDD.pdf` — a data da consulta, sem dados pessoais (BR-CLN-54). */
export function examOrderFilename(consultationAt: Date): string {
  return `pedido-exame-${localDateIso(consultationAt).replaceAll("-", "")}.pdf`;
}

/** `declaracao-AAAAMMDD.pdf` — a data da consulta, sem dados pessoais (BR-CLN-55). */
export function attendanceStatementFilename(consultationAt: Date): string {
  return `declaracao-${localDateIso(consultationAt).replaceAll("-", "")}.pdf`;
}

/** `orders`: os pedidos ATIVOS (não cancelados) da marcação, por ordem de criação; o retrato do primeiro identifica paciente, data e profissional. */
export function buildExamOrderDocument(orders: ExamOrder[], issuer: ReportIssuer, generatedAt: Date): PdfDocument {
  const first = orders[0];
  const blocks: PdfBlock[] = [];
  if (first) {
    blocks.push({ kind: "paragraph", text: first.patientBirthDate ? `Paciente: ${first.patientName} (nascimento: ${formatIsoDate(first.patientBirthDate)})` : `Paciente: ${first.patientName}` });
    blocks.push({ kind: "paragraph", text: `Data da consulta: ${formatLocalDateTime(first.consultationAt)}` });
    blocks.push({ kind: "spacer" });
  }
  blocks.push({ kind: "heading", text: "Exames pedidos" });
  orders.forEach((order, index) => {
    blocks.push({ kind: "paragraph", text: `${String(index + 1)}. ${order.name}${order.urgent ? " — URGENTE" : ""}` });
    if (order.note) blocks.push({ kind: "paragraph", text: `Nota: ${order.note}`, muted: true });
  });
  blocks.push({ kind: "spacer" });
  if (first) blocks.push({ kind: "paragraph", text: first.authorName });
  return { header: issuerHeader(issuer), title: "Pedido de exame", blocks, footer: EXAM_ORDER_NOTICE, generatedAt };
}

export interface AttendanceStatementInput {
  patientName: string;
  consultationAt: Date;
  /** Só com `includeProfessional=true` e nome conhecido. */
  professionalName?: string | null;
}

/** Sem especialidade, diagnóstico, serviço, relatório, hora de saída nem duração (um empregador pode ler este papel). */
export function buildAttendanceStatementDocument(input: AttendanceStatementInput, issuer: ReportIssuer, generatedAt: Date): PdfDocument {
  const blocks: PdfBlock[] = [
    { kind: "paragraph", text: `Declara-se que o/a paciente ${input.patientName} compareceu à consulta marcada para ${formatLocalDateTime(input.consultationAt)}.` },
  ];
  if (input.professionalName) blocks.push({ kind: "paragraph", text: `Profissional: ${input.professionalName}` });
  blocks.push({ kind: "spacer" });
  blocks.push({ kind: "paragraph", text: `Emitida em ${formatLocalDateTime(generatedAt)}.`, muted: true });
  return { header: issuerHeader(issuer), title: "Declaração de presença", blocks, footer: ATTENDANCE_NOTICE, generatedAt };
}
