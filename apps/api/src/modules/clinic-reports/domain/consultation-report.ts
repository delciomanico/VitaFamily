// Entidade pura `ConsultationReport` (entities.md, M15 S, ADR-027, BR-CLN-41..45) e regras de validação/estado. Sem I/O.
// O texto é DADO DE SAÚDE (BR-HLT-05): nunca vai para logs, auditoria nem mensagens de erro.
import { DomainError, ValidationError, type FieldError } from "../../../platform/errors/index.js";

export type ConsultationBookingKind = "APPOINTMENT" | "VISIT";
export type ConsultationReportStatus = "DRAFT" | "FINAL";

export interface ReportIssuer {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ReportAddendum {
  id: string;
  text: string;
  authorName: string;
  authorAccountId: string | null;
  createdAt: Date;
}

export interface ConsultationReport {
  id: string;
  clinicId: string;
  bookingKind: ConsultationBookingKind;
  bookingId: string;
  clinicPatientId: string | null;
  status: ConsultationReportStatus;
  reason: string | null;
  findings: string | null;
  impression: string | null;
  plan: string | null;
  sharedWithPatient: boolean;
  patientName: string;
  patientBirthDate: string | null;
  consultationAt: Date;
  specialty: string | null;
  authorName: string;
  issuer: ReportIssuer | null;
  authorAccountId: string | null;
  finalizedAt: Date | null;
  addenda: ReportAddendum[];
  createdAt: Date;
  updatedAt: Date;
}

/** BR-CLN-41: limites por secção (caracteres Unicode, como `char_length` na BD). */
export const SECTION_LIMITS = { reason: 300, findings: 1500, impression: 500, plan: 1500 } as const;
export type SectionName = keyof typeof SECTION_LIMITS;
export const SECTION_NAMES = Object.keys(SECTION_LIMITS) as SectionName[];
export const ADDENDUM_TEXT_MAX = 1500;
/** BR-CLN-43. */
export const MAX_ADDENDA = 20;
export const REPORT_NOTICE = "Documento não fiscal. Não substitui receita médica nem atestado.";

export interface ReportSections {
  reason: string | null;
  findings: string | null;
  impression: string | null;
  plan: string | null;
}

export interface ReportInput extends ReportSections {
  /** `undefined` = manter (rascunho existente) ou omissão `true`. */
  sharedWithPatient?: boolean;
}

/** Caracteres de controlo (exceto quebra de linha) rejeitados (BR-CLN-41): C0 sem `\n`, DEL e C1. */
function hasControlChars(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code < 0x20 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export function charLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Texto simples: `\r\n` -> `\n`, aparado; vazio => `null`. Rejeita caracteres de controlo e excesso de comprimento.
 * Sem HTML/markdown: o texto nunca é interpretado (o PDF só o desenha).
 */
function normalizeText(value: unknown, field: string, max: number, errors: FieldError[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors.push({ field, message: "tem de ser texto" });
    return null;
  }
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text === "") return null;
  if (hasControlChars(text)) {
    errors.push({ field, message: "contém caracteres de controlo" });
    return null;
  }
  if (charLength(text) > max) {
    errors.push({ field, message: `no máximo ${String(max)} caracteres` });
    return null;
  }
  return text;
}

const INPUT_KEYS = new Set<string>([...SECTION_NAMES, "sharedWithPatient"]);

/** `ConsultationReportInput` (BR-CLN-41): ≥1 secção preenchida; campos desconhecidos rejeitados (como o contrato). */
export function parseReportInput(body: unknown): ReportInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError([{ field: "report", message: "objeto esperado" }], { detail: "Relatório inválido." });
  }
  const record = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const key of Object.keys(record)) {
    if (!INPUT_KEYS.has(key)) errors.push({ field: key, message: "campo desconhecido" });
  }
  const sections = {} as ReportSections;
  for (const name of SECTION_NAMES) {
    sections[name] = normalizeText(record[name], name, SECTION_LIMITS[name], errors);
  }
  let shared: boolean | undefined;
  if (record.sharedWithPatient !== undefined) {
    if (typeof record.sharedWithPatient === "boolean") shared = record.sharedWithPatient;
    else errors.push({ field: "sharedWithPatient", message: "tem de ser booleano" });
  }
  if (errors.length === 0 && countSections(sections) === 0) {
    errors.push({ field: "findings", message: "preencha pelo menos uma secção" });
  }
  if (errors.length > 0) {
    throw new ValidationError(errors, { detail: "Relatório inválido." });
  }
  return { ...sections, ...(shared !== undefined ? { sharedWithPatient: shared } : {}) };
}

export function countSections(sections: ReportSections): number {
  return SECTION_NAMES.filter((name) => sections[name] !== null).length;
}

/** `ConsultationReportAddendumInput` (BR-CLN-43): `text` 1–1500, sem controlo. */
export function parseAddendumInput(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError([{ field: "text", message: "obrigatório" }], { detail: "Adenda inválida." });
  }
  const record = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const key of Object.keys(record)) {
    if (key !== "text") errors.push({ field: key, message: "campo desconhecido" });
  }
  const text = normalizeText(record.text, "text", ADDENDUM_TEXT_MAX, errors);
  if (text === null) errors.push({ field: "text", message: "obrigatório" });
  if (errors.length > 0 || text === null) throw new ValidationError(errors, { detail: "Adenda inválida." });
  return text;
}

/** BR-CLN-41/42: só marcações `SCHEDULED` ou `COMPLETED` admitem relatório. */
export function assertBookingAllowsReport(status: string): void {
  if (status !== "SCHEDULED" && status !== "COMPLETED") {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Só consultas em curso ou concluídas admitem relatório." });
  }
}

/** BR-CLN-42/43: o `FINAL` não se edita (correção = adenda). */
export function assertEditable(report: Pick<ConsultationReport, "status"> | null): void {
  if (report?.status === "FINAL") {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "O relatório final é imutável; acrescente uma adenda." });
  }
}

/** BR-CLN-45: visita manual nunca é partilhada; consulta Vita omite => `true` (ou mantém o do rascunho). */
export function resolveSharedWithPatient(kind: ConsultationBookingKind, requested: boolean | undefined, existing: boolean | undefined): boolean {
  if (kind === "VISIT") return false;
  return requested ?? existing ?? true;
}
