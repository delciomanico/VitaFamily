// Entidade pura `Examination` (entities.md, categoria C6) e regras simples (BR-EXM-04,
// state-machines.md "Examination", ST5). Sem I/O.
import { DomainError, ValidationError } from "../../../platform/errors/index.js";

/** state-machines.md "Examination" (ADR-023 revisto 2026-11-04): sem `REQUESTED`/`REJECTED` — a
 * marcação num horário da clínica nasce `SCHEDULED`; os valores só sobrevivem no enum de BD (migração 0022). */
export type ExaminationStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED";

/** BR-CLN-08 (espelho de BR-RX-07): quem emitiu os resultados. */
export type ExaminationIssuer = "FAMILY" | "CLINIC";

/** BR-CLN-08: máximo de parâmetros que a clínica emite ao completar. */
export const MAX_CLINIC_RESULTS = 50;
/** BR-CLN-08 / openapi `ClinicCompleteExaminationRequest.resultNote`. */
export const MAX_CLINIC_RESULT_NOTE_LENGTH = 2000;
/** Fuso do portal da clínica (a Vita Family só opera em Portugal, `clinics/domain/clinic-slot-time.ts`). */
const CLINIC_TIMEZONE = "Europe/Lisbon";

export interface Examination {
  id: string;
  familyId: string;
  memberId: string;
  name: string;
  examDate: string; // date (YYYY-MM-DD)
  status: ExaminationStatus;
  clinicId?: string;
  clinicName?: string;
  /** Data/hora do horário da clínica (D19) — só quando nasceu de um `slotId`. */
  scheduledAt?: Date;
  /** Horário EXAM de clínica parceira de origem (D19, BR-EXM-05). */
  slotId?: string;
  /** Motivo da clínica ao cancelar (D19). */
  responseNote?: string;
  notes?: string;
  issuedBy: ExaminationIssuer;
  issuedByClinicAccountId?: string;
  resultsIssuedAt?: Date;
  /** Nota da clínica ao completar (BR-CLN-08); nunca escrita pela família — distinta de `notes`. */
  clinicResultNote?: string;
  createdAt: Date;
}

const ALLOWED_EXAMINATION_TRANSITIONS: Record<ExaminationStatus, ExaminationStatus[]> = {
  SCHEDULED: ["COMPLETED", "CANCELLED"],
  CANCELLED: ["SCHEDULED"],
  COMPLETED: [],
};

/**
 * state-machines.md "Examination": transições permitidas; idêntico ao atual é sempre idempotente.
 * BR-EXM-08: um exame de clínica parceira (`hasSlot`) cancelado não se reagenda
 * (`CANCELLED -> SCHEDULED` proibido) — pede-se um novo horário.
 */
export function assertValidExaminationTransition(from: ExaminationStatus, to: ExaminationStatus, options: { hasSlot?: boolean } = {}): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_EXAMINATION_TRANSITIONS[from].includes(to) || (from === "CANCELLED" && to === "SCHEDULED" && options.hasSlot)) {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Transição de estado do exame não permitida." });
  }
}

/** BR-EXM-05: `examDate` de um exame de clínica = data LOCAL (Europe/Lisbon) do horário. */
export function localExamDate(startsAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(startsAt);
  return parts; // en-CA -> AAAA-MM-DD
}

/**
 * BR-CLN-08/UC-CLN-10: completar pela clínica exige pelo menos um parâmetro ou um PDF carregado;
 * no máximo 50 parâmetros e nota até 2000 caracteres. Sem qualquer interpretação do conteúdo (D11).
 */
export function assertValidClinicCompletion(params: { resultsCount: number; documentsCount: number; resultNote?: string | null }): void {
  if (params.resultsCount > MAX_CLINIC_RESULTS) {
    throw new ValidationError([{ field: "results", message: `no máximo ${String(MAX_CLINIC_RESULTS)} parâmetros` }], { detail: "Demasiados parâmetros." });
  }
  if (params.resultNote && params.resultNote.length > MAX_CLINIC_RESULT_NOTE_LENGTH) {
    throw new ValidationError([{ field: "resultNote", message: `no máximo ${String(MAX_CLINIC_RESULT_NOTE_LENGTH)} caracteres` }], { detail: "Nota demasiado longa." });
  }
  if (params.resultsCount === 0 && params.documentsCount === 0) {
    throw new ValidationError([{ field: "results", message: "indique pelo menos um resultado ou carregue um PDF" }], { detail: "Sem resultados nem PDF." });
  }
}

/** Nome obrigatório, sem espaços nas pontas, nunca vazio (mesmo critério de `health-records`). */
export function assertValidExaminationName(name: string, field = "name"): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError([{ field, message: "não pode ser vazio" }], { detail: "Nome inválido." });
  }
  return trimmed;
}

/** `examDate` tem de ser uma data válida (sem limite de passado/futuro — ao contrário de BR-RX-01). */
export function assertValidExamDate(examDate: string, field = "examDate"): void {
  const date = new Date(`${examDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field, message: "data inválida" }], { detail: "Data do exame inválida." });
  }
}

/** ST5: exame com `examDate` passada (ou hoje) nasce COMPLETED; futura nasce SCHEDULED. */
export function deriveInitialExaminationStatus(examDate: string, now: Date): ExaminationStatus {
  const today = now.toISOString().slice(0, 10);
  return examDate <= today ? "COMPLETED" : "SCHEDULED";
}
