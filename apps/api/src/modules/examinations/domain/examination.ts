// Entidade pura `Examination` (entities.md, categoria C6) e regras simples (BR-EXM-04,
// state-machines.md "Examination", ST5). Sem I/O.
import { DomainError, ValidationError } from "../../../platform/errors/index.js";

export type ExaminationStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED";

export interface Examination {
  id: string;
  familyId: string;
  memberId: string;
  name: string;
  examDate: string; // date (YYYY-MM-DD)
  status: ExaminationStatus;
  clinicId?: string;
  clinicName?: string;
  notes?: string;
  createdAt: Date;
}

const ALLOWED_EXAMINATION_TRANSITIONS: Record<ExaminationStatus, ExaminationStatus[]> = {
  SCHEDULED: ["COMPLETED", "CANCELLED"],
  CANCELLED: ["SCHEDULED"],
  COMPLETED: [],
};

/** state-machines.md "Examination": transições permitidas; idêntico ao atual é sempre idempotente. */
export function assertValidExaminationTransition(from: ExaminationStatus, to: ExaminationStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_EXAMINATION_TRANSITIONS[from].includes(to)) {
    throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Transição de estado do exame não permitida." });
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
