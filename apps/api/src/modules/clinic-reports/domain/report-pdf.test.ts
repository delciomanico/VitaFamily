// BR-CLN-46: PDF do relatório — só secções preenchidas, adendas, assinatura textual, rodapé fixo, marca de rascunho, nome do
// ficheiro sem dados pessoais, fuso CLINIC_TIMEZONE.
import { describe, expect, it } from "vitest";
import type { ConsultationReport } from "./consultation-report.js";
import { buildConsultationReportDocument, formatLocalDateTime, reportFilename } from "./report-pdf.js";

const T = new Date("2026-07-01T08:30:00Z"); // verão: Europe/Lisbon = UTC+1
function report(overrides: Partial<ConsultationReport> = {}): ConsultationReport {
  return {
    id: "r1", clinicId: "c1", bookingKind: "APPOINTMENT", bookingId: "b1", clinicPatientId: null, status: "FINAL",
    reason: "Dor lombar.", findings: null, impression: "Lombalgia.", plan: null, sharedWithPatient: true,
    patientName: "Maria Silva", patientBirthDate: "1990-03-04", consultationAt: T, specialty: "Medicina Geral", authorName: "Dr. João Costa",
    issuer: { name: "Clínica Sol" }, authorAccountId: "a1", finalizedAt: new Date("2026-07-01T09:00:00Z"),
    addenda: [{ id: "x", text: "Resultado recebido.", authorName: "Dr. João Costa", authorAccountId: "a1", createdAt: new Date("2026-07-02T10:00:00Z") }],
    createdAt: T, updatedAt: T, ...overrides,
  };
}

describe("buildConsultationReportDocument", () => {
  it("só as secções preenchidas, adendas, assinatura textual com data de finalização no fuso da clínica e rodapé fixo", () => {
    const doc = buildConsultationReportDocument(report(), { name: "Clínica Sol", address: "Rua 1" }, T);
    const sections = doc.blocks.flatMap((b) => (b.kind === "section" ? [b.title] : []));
    expect(sections).toEqual(["Motivo da consulta", "Diagnóstico / impressão", expect.stringContaining("Dr. João Costa")]);
    const text = JSON.stringify(doc.blocks);
    expect(text).toContain("Paciente: Maria Silva (nascimento: 04/03/1990)");
    expect(text).toContain("01/07/2026, 09:30"); // 08:30Z em Lisboa (verão)
    expect(text).toContain("Dr. João Costa — Medicina Geral · finalizado em 01/07/2026, 10:00");
    expect(doc.footer).toBe("Documento não fiscal. Não substitui receita médica nem atestado.");
    expect(doc.watermark).toBeUndefined();
    expect(doc.header).toEqual(["Clínica Sol", "Rua 1"]);
  });

  it("DRAFT leva a marca 'RASCUNHO — sem valor' e não tem 'finalizado em'", () => {
    const doc = buildConsultationReportDocument(report({ status: "DRAFT", finalizedAt: null, issuer: null, addenda: [] }), { name: "Clínica Sol" }, T);
    expect(doc.watermark).toBe("RASCUNHO — sem valor");
    expect(JSON.stringify(doc.blocks)).not.toContain("finalizado em");
  });

  it("sem data de nascimento não a mostra", () => {
    const doc = buildConsultationReportDocument(report({ patientBirthDate: null }), { name: "Clínica Sol" }, T);
    expect(JSON.stringify(doc.blocks)).toContain("Paciente: Maria Silva");
    expect(JSON.stringify(doc.blocks)).not.toContain("nascimento");
  });
});

describe("formatação", () => {
  it("fuso: inverno UTC+0, verão UTC+1; fim de semana de mudança de hora", () => {
    expect(formatLocalDateTime(new Date("2026-01-15T10:00:00Z"))).toBe("15/01/2026, 10:00");
    expect(formatLocalDateTime(new Date("2026-07-15T10:00:00Z"))).toBe("15/07/2026, 11:00");
  });

  it("nome do ficheiro = relatorio-AAAAMMDD.pdf (dia local da consulta), sem dados pessoais", () => {
    expect(reportFilename(new Date("2026-07-01T23:30:00Z"))).toBe("relatorio-20260702.pdf");
    expect(reportFilename(T)).toBe("relatorio-20260701.pdf");
  });
});
