// Montagem pura do PDF do relatório da consulta (BR-CLN-46, ADR-027). Fuso `CLINIC_TIMEZONE`; só as secções preenchidas.
import { CLINIC_TIMEZONE, localDateIso } from "../../../platform/time/index.js";
import { REPORT_NOTICE, type ConsultationReport, type ReportIssuer } from "./consultation-report.js";
import type { PdfBlock, PdfDocument } from "./pdf-document.js";

const dateTimeFormat = new Intl.DateTimeFormat("pt-PT", { timeZone: CLINIC_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateFormat = new Intl.DateTimeFormat("pt-PT", { timeZone: CLINIC_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" });

/** `DD/MM/AAAA, HH:mm` no fuso da clínica. */
export function formatLocalDateTime(instant: Date): string {
  return dateTimeFormat.format(instant);
}

export function formatLocalDate(instant: Date): string {
  return dateFormat.format(instant);
}

/** `AAAA-MM-DD` -> `DD/MM/AAAA`. */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d ?? ""}/${m ?? ""}/${y ?? ""}`;
}

export function issuerHeader(issuer: ReportIssuer): string[] {
  return [issuer.name, ...[issuer.address, issuer.phone, issuer.email].filter((v): v is string => typeof v === "string" && v !== "")];
}

/** `relatorio-AAAAMMDD.pdf` — a data da consulta, sem dados pessoais (BR-CLN-46). */
export function reportFilename(consultationAt: Date): string {
  return `relatorio-${localDateIso(consultationAt).replaceAll("-", "")}.pdf`;
}

/**
 * `issuer`: o retrato do `FINAL`; num `DRAFT` o perfil atual da clínica (BR-CLN-46). `DRAFT` leva a marca
 * "RASCUNHO — sem valor"; a assinatura textual só existe com o `FINAL` (não é assinatura eletrónica qualificada, OP-48).
 */
export function buildConsultationReportDocument(report: ConsultationReport, issuer: ReportIssuer, generatedAt: Date): PdfDocument {
  const blocks: PdfBlock[] = [
    { kind: "paragraph", text: report.patientBirthDate ? `Paciente: ${report.patientName} (nascimento: ${formatIsoDate(report.patientBirthDate)})` : `Paciente: ${report.patientName}` },
    { kind: "paragraph", text: `Data e hora da consulta: ${formatLocalDateTime(report.consultationAt)}${report.specialty ? ` · ${report.specialty}` : ""}` },
    { kind: "spacer" },
  ];
  const sections: [string, string | null][] = [
    ["Motivo da consulta", report.reason],
    ["Achados / observação", report.findings],
    ["Diagnóstico / impressão", report.impression],
    ["Conduta / plano", report.plan],
  ];
  for (const [title, body] of sections) {
    if (body !== null) blocks.push({ kind: "section", title, body });
  }
  if (report.addenda.length > 0) {
    blocks.push({ kind: "heading", text: "Adendas" });
    for (const addendum of report.addenda) {
      blocks.push({ kind: "section", title: `${formatLocalDateTime(addendum.createdAt)} — ${addendum.authorName}`, body: addendum.text });
    }
  }
  blocks.push({ kind: "spacer" });
  blocks.push({
    kind: "paragraph",
    text: report.finalizedAt ? `${report.authorName}${report.specialty ? ` — ${report.specialty}` : ""} · finalizado em ${formatLocalDateTime(report.finalizedAt)}` : `${report.authorName}${report.specialty ? ` — ${report.specialty}` : ""}`,
  });
  return {
    header: issuerHeader(issuer),
    title: "Relatório da consulta",
    ...(report.status === "DRAFT" ? { watermark: "RASCUNHO — sem valor" } : {}),
    blocks,
    footer: REPORT_NOTICE,
    generatedAt,
  };
}
