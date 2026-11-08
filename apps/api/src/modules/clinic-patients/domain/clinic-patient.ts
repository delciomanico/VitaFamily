// Entidade pura `ClinicPatient` (BR-CLN-17/22, entities.md): registo próprio da clínica, separado dos dados
// Vita. Validação, normalização para pesquisa e cursor de paginação. Sem I/O.
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";

export type ClinicPatientOrigin = "MANUAL" | "VITA";
export type ClinicLinkVia = "EMAIL" | "CODE";

export interface ClinicPatient {
  id: string;
  clinicId: string;
  name: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  notes?: string;
  origin: ClinicPatientOrigin;
  createdAt: Date;
  updatedAt: Date;
}

export const PATIENT_NAME_MAX = 120;
export const PATIENT_PHONE_MAX = 30;
export const PATIENT_EMAIL_MAX = 254;
export const PATIENT_NOTES_MAX = 2000;
export const SEARCH_Q_MIN = 2;
export const SEARCH_Q_MAX = 100;
export const PHONE_SEARCH_MIN_DIGITS = 3;
const PHONE_PATTERN = /^[+0-9 ()-]{5,30}$/;
const PHONE_QUERY_PATTERN = /^[+0-9 ()-]+$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minúsculas, sem acentos, espaços colapsados — `name_norm` e `q` de nome (BR-CLN-22). */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export interface PatientDraft {
  name: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  notes: string | null;
}

export interface PatientPatchDraft {
  name?: string;
  phone?: string | null;
  email?: string | null;
  birthDate?: string | null;
  notes?: string | null;
}

function fail(errors: FieldError[]): never {
  throw new ValidationError(errors, { detail: "Dados do paciente inválidos." });
}

function parseName(value: unknown, errors: FieldError[]): string | undefined {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > PATIENT_NAME_MAX) {
    errors.push({ field: "name", message: `entre 1 e ${String(PATIENT_NAME_MAX)} caracteres` });
    return undefined;
  }
  return value.trim();
}

function parseOptionalText(field: string, value: unknown, max: number, errors: FieldError[]): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") {
    errors.push({ field, message: "texto inválido" });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    errors.push({ field, message: `máximo ${String(max)} caracteres` });
    return undefined;
  }
  return trimmed.length === 0 ? null : trimmed;
}

function parsePhone(value: unknown, errors: FieldError[]): string | null | undefined {
  const text = parseOptionalText("phone", value, PATIENT_PHONE_MAX, errors);
  if (typeof text === "string" && !PHONE_PATTERN.test(text)) {
    errors.push({ field: "phone", message: "telefone inválido" });
    return undefined;
  }
  return text;
}

function parseEmail(value: unknown, errors: FieldError[]): string | null | undefined {
  const text = parseOptionalText("email", value, PATIENT_EMAIL_MAX, errors);
  if (typeof text === "string") {
    const lower = text.toLowerCase();
    if (!EMAIL_SHAPE.test(lower)) {
      errors.push({ field: "email", message: "e-mail inválido" });
      return undefined;
    }
    return lower;
  }
  return text;
}

/** BR-CLN-17: `birthDate` data real e não futura (`today` = AAAA-MM-DD no relógio injetado). */
function parseBirthDate(value: unknown, today: string, errors: FieldError[]): string | null | undefined {
  if (value === null) return null;
  const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
  if (!match) {
    errors.push({ field: "birthDate", message: "data inválida (AAAA-MM-DD)" });
    return undefined;
  }
  const date = new Date(`${value as string}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    errors.push({ field: "birthDate", message: "data inválida" });
    return undefined;
  }
  if ((value) > today) {
    errors.push({ field: "birthDate", message: "não pode ser futura" });
    return undefined;
  }
  return value;
}

export function parsePatientInput(input: Record<string, unknown>, today: string): PatientDraft {
  const errors: FieldError[] = [];
  const name = parseName(input.name, errors);
  const phone = input.phone === undefined ? null : parsePhone(input.phone, errors);
  const email = input.email === undefined ? null : parseEmail(input.email, errors);
  const birthDate = input.birthDate === undefined ? null : parseBirthDate(input.birthDate, today, errors);
  const notes = input.notes === undefined ? null : parseOptionalText("notes", input.notes, PATIENT_NOTES_MAX, errors);
  if (errors.length > 0 || name === undefined) fail(errors);
  return { name, phone: phone ?? null, email: email ?? null, birthDate: birthDate ?? null, notes: notes ?? null };
}

export function parsePatientPatch(input: Record<string, unknown>, today: string): PatientPatchDraft {
  const errors: FieldError[] = [];
  const draft: PatientPatchDraft = {};
  if ("name" in input) {
    const name = parseName(input.name, errors);
    if (name !== undefined) draft.name = name;
  }
  if ("phone" in input) {
    const phone = parsePhone(input.phone, errors);
    if (phone !== undefined) draft.phone = phone;
  }
  if ("email" in input) {
    const email = parseEmail(input.email, errors);
    if (email !== undefined) draft.email = email;
  }
  if ("birthDate" in input) {
    const birthDate = parseBirthDate(input.birthDate, today, errors);
    if (birthDate !== undefined) draft.birthDate = birthDate;
  }
  if ("notes" in input) {
    const notes = parseOptionalText("notes", input.notes, PATIENT_NOTES_MAX, errors);
    if (notes !== undefined) draft.notes = notes;
  }
  if (errors.length === 0 && Object.keys(draft).length === 0) {
    errors.push({ field: "body", message: "pelo menos um campo" });
  }
  if (errors.length > 0) fail(errors);
  return draft;
}

/** Termos de pesquisa derivados de `q` (BR-CLN-22). `phoneDigits` só com ≥3 dígitos e q "tipo telefone". */
export interface PatientSearchTerms {
  name: string;
  email: string;
  phoneDigits: string | null;
}

export function parseSearchQuery(raw: unknown, required: boolean): string | undefined {
  if (raw === undefined && !required) return undefined;
  const q = typeof raw === "string" ? raw.trim() : "";
  if (q.length < SEARCH_Q_MIN || q.length > SEARCH_Q_MAX) {
    throw new ValidationError([{ field: "q", message: `entre ${String(SEARCH_Q_MIN)} e ${String(SEARCH_Q_MAX)} caracteres` }], { detail: "Pesquisa inválida." });
  }
  return q;
}

export function buildSearchTerms(q: string): PatientSearchTerms {
  const digits = PHONE_QUERY_PATTERN.test(q) ? phoneDigits(q) : "";
  return { name: normalizeSearchText(q), email: q.trim().toLowerCase(), phoneDigits: digits.length >= PHONE_SEARCH_MIN_DIGITS ? digits : null };
}

/** Equivalente em memória da pesquisa SQL (`strpos`), para testes de paridade e fakes. */
export function patientMatches(patient: Pick<ClinicPatient, "name" | "email" | "phone">, terms: PatientSearchTerms): boolean {
  if (normalizeSearchText(patient.name).includes(terms.name)) return true;
  if (patient.email?.includes(terms.email)) return true;
  return terms.phoneDigits !== null && patient.phone !== undefined && phoneDigits(patient.phone).includes(terms.phoneDigits);
}

/** Cursor opaco `(name_norm, id)` da listagem por nome (estável). */
export interface PatientCursor {
  n: string;
  i: string;
}

export function encodeCursor(cursor: PatientCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): PatientCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<PatientCursor>;
    if (typeof parsed.n === "string" && typeof parsed.i === "string" && /^[0-9a-f-]{36}$/i.test(parsed.i)) {
      return { n: parsed.n, i: parsed.i };
    }
  } catch {
    // cai para o erro abaixo
  }
  throw new ValidationError([{ field: "cursor", message: "cursor inválido" }], { detail: "Cursor inválido." });
}

/** `AAAA-MM-DD` do instante (UTC) — `birthDate` não futura. */
export function isoDateOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}
