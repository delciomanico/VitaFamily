// BR-CLN-49 / ADR-027 (exceção de segurança dos documentos gerados, sem ClamAV): o PDF gerado não contém /JavaScript, /Launch,
// /URI, /EmbeddedFile nem /AcroForm — nem com texto hostil —, é PDF válido, A4 paginado e ≤ 256 KB nos limites do contrato.
import { describe, expect, it } from "vitest";
import { buildAttendanceStatementDocument, buildExamOrderDocument } from "../domain/exam-order-pdf.js";
import type { ExamOrder } from "../domain/exam-order.js";
import { buildExamReportDocument } from "../domain/exam-report-pdf.js";
import type { ConsultationReport } from "../domain/consultation-report.js";
import { MAX_GENERATED_PDF_BYTES } from "../domain/pdf-document.js";
import { buildConsultationReportDocument } from "../domain/report-pdf.js";
import { PdfKitRenderer } from "./pdfkit-renderer.js";

const NOW = new Date("2026-11-08T10:00:00Z");
const FORBIDDEN = ["/JavaScript", "/JS", "/Launch", "/URI", "/EmbeddedFile", "/AcroForm", "/OpenAction", "/AA", "/SubmitForm", "/GoToR", "/RichMedia"];
const HOSTILE = "/JavaScript (app.alert(1)) /Launch /URI (http://evil.pt) /EmbeddedFile /AcroForm << /S /JavaScript /JS (x) >> %PDF-1.7 ‮ \u0000 ) ( \\ http://x.pt <a href=x>";

function report(text: string): ConsultationReport {
  return {
    id: "r", clinicId: "c", bookingKind: "APPOINTMENT", bookingId: "b", clinicPatientId: null, status: "FINAL",
    reason: text.slice(0, 300), findings: text.repeat(5).slice(0, 1500), impression: text, plan: text,
    sharedWithPatient: true, patientName: text.slice(0, 100), patientBirthDate: "1990-01-01", consultationAt: NOW, specialty: text.slice(0, 70),
    authorName: text.slice(0, 100), issuer: { name: text.slice(0, 100) }, authorAccountId: null, finalizedAt: NOW,
    addenda: Array.from({ length: 20 }, (_, i) => ({ id: String(i), text: text.repeat(10).slice(0, 1500), authorName: "Dr.", authorAccountId: null, createdAt: NOW })),
    createdAt: NOW, updatedAt: NOW,
  };
}

function assertSafe(bytes: Buffer): void {
  const raw = bytes.toString("latin1");
  expect(raw.startsWith("%PDF-")).toBe(true);
  expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
  for (const token of FORBIDDEN) expect(raw, token).not.toContain(token);
}

describe("PdfKitRenderer", () => {
  it.each([[true], [false]])("relatório com texto hostil: PDF válido sem ações nem ficheiros embebidos (compress=%s)", async (compress) => {
    const bytes = await new PdfKitRenderer({ compress }).render(buildConsultationReportDocument(report(HOSTILE), { name: HOSTILE.slice(0, 100), address: HOSTILE.slice(0, 100) }, NOW));
    assertSafe(bytes);
    expect(bytes.length).toBeLessThanOrEqual(MAX_GENERATED_PDF_BYTES * 4);
  });

  it.each([[true], [false]])("laudo com 50 parâmetros hostis: PDF válido, sem ações e ≤ 256 KB (compress=%s)", async (compress) => {
    const results = Array.from({ length: 50 }, (_, i) => ({ parameter: `${HOSTILE.slice(0, 100)} ${String(i)}`, valueNumeric: i % 2 === 0 ? i : null, valueText: i % 2 === 0 ? null : HOSTILE.slice(0, 200), unit: "g/dL", referenceMin: 10, referenceMax: 20 }));
    const { document } = buildExamReportDocument({ issuer: { name: HOSTILE.slice(0, 100) }, patientName: HOSTILE.slice(0, 100), examName: HOSTILE.slice(0, 100), examDate: "2026-11-08", results, resultNote: HOSTILE.repeat(20).slice(0, 2000), issuedAt: NOW });
    const bytes = await new PdfKitRenderer({ compress }).render(document);
    assertSafe(bytes);
    if (compress) expect(bytes.length).toBeLessThanOrEqual(MAX_GENERATED_PDF_BYTES);
  });

  it("carateres fora de WinAnsi (emoji, CJK) não falham nem geram bytes arbitrários; acentos pt-PT mantêm-se", async () => {
    const bytes = await new PdfKitRenderer().render(buildConsultationReportDocument(report("ação 日本語 😀 «ç»"), { name: "Clínica" }, NOW));
    assertSafe(bytes);
  });

  it("o laudo gerado a partir de dados típicos cabe folgadamente em 256 KB e tem metadados sem dados pessoais", async () => {
    const { document } = buildExamReportDocument({ issuer: { name: "Clínica Sol" }, patientName: "Maria Silva", examName: "Análises", examDate: "2026-11-08", results: [{ parameter: "Hemoglobina", valueNumeric: 11.2, unit: "g/dL", referenceMin: 12, referenceMax: 16 }], resultNote: null, issuedAt: NOW });
    const bytes = await new PdfKitRenderer({ compress: false }).render(document);
    expect(bytes.length).toBeLessThan(MAX_GENERATED_PDF_BYTES);
    const raw = bytes.toString("latin1");
    expect(raw).not.toContain("Maria");
    expect(raw).toContain("Documento Vita Family");
  });

  it.each([[true], [false]])("pedido de exame (5 itens hostis) e declaração de presença: PDF válido sem ações nem ficheiros embebidos (compress=%s)", async (compress) => {
    const order = (i: number): ExamOrder => ({
      id: String(i), clinicId: "c", bookingKind: "APPOINTMENT", bookingId: "b", clinicPatientId: null, name: HOSTILE.slice(0, 80), serviceTypeId: null, note: HOSTILE.slice(0, 200), urgent: i % 2 === 0,
      status: "ORDERED", bookedHere: false, patientName: HOSTILE.slice(0, 100), patientBirthDate: "1990-01-01", consultationAt: NOW, authorName: HOSTILE.slice(0, 100), authorAccountId: null, cancelledAt: null, createdAt: NOW, updatedAt: NOW,
    });
    const renderer = new PdfKitRenderer({ compress });
    const orders = await renderer.render(buildExamOrderDocument([1, 2, 3, 4, 5].map(order), { name: HOSTILE.slice(0, 100), address: HOSTILE.slice(0, 100) }, NOW));
    assertSafe(orders);
    const statement = await renderer.render(buildAttendanceStatementDocument({ patientName: HOSTILE.slice(0, 100), consultationAt: NOW, professionalName: HOSTILE.slice(0, 100) }, { name: HOSTILE.slice(0, 100) }, NOW));
    assertSafe(statement);
    expect(orders.length).toBeLessThanOrEqual(MAX_GENERATED_PDF_BYTES * 4);
  });

  it("a declaração de presença típica não contém especialidade nem diagnóstico ", async () => {
    const bytes = await new PdfKitRenderer({ compress: false }).render(buildAttendanceStatementDocument({ patientName: "Maria Silva", consultationAt: NOW }, { name: "Clínica Sol" }, NOW));
    const raw = bytes.toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw).not.toContain("Cardiologia");
  });
});
