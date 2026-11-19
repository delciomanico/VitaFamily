// Tipos do domínio de `processes` (entities.md "Process", state-machines.md "Process", BR-PRC-01..04).
// Sem I/O e sem importar nada fora de `domain/` (TC-PRC-20).
// Conjuntos abertos: as fatias seguintes acrescentam valores (BR-PRC-10) por `ADD VALUE` na BD e aqui.

/** Só `ROUTINE`: o valor `AUTHORIZED` do enum da BD (marco B, ADR-037) ficou inerte e nunca é lido. */
export type ProcessKind = "ROUTINE";

/** O que abriu o processo: um ato (consulta/exame) ou, desde MK3, uma marcação de profissional. `AUTHORIZATION` (marco B) ficou inerte na BD e nunca é lido. */
export type ProcessOriginType = "APPOINTMENT" | "EXAMINATION" | "BOOKING";
export const PROCESS_ORIGIN_TYPES: readonly ProcessOriginType[] = ["APPOINTMENT", "EXAMINATION", "BOOKING"];

/** Fase do ato publicada pelo módulo dono (BR-PRC-04; state-machines.md "Process", projeção 1). */
export type ActPhase = "PENDING" | "SCHEDULED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "NO_SHOW";
export const ACT_PHASES: readonly ActPhase[] = ["PENDING", "SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED", "NO_SHOW"];

/** Dica de pagamento/avaliação de uma marcação (MK3, state-machines.md 1b), calculada por `consultations`; só `source=BOOKING` a tem. */
export type BookingHint = "PAYMENT_PROOF_DUE" | "PAYMENT_UNDER_REVIEW" | "PAYMENT_DISPUTED" | "REVIEW_DUE";
export const BOOKING_HINTS: readonly BookingHint[] = ["PAYMENT_PROOF_DUE", "PAYMENT_UNDER_REVIEW", "PAYMENT_DISPUTED", "REVIEW_DUE"];

/** Facto pequeno e estável do ato (BR-PRC-04): é tudo o que `processes` sabe do estado de um ato. */
export interface ActFact {
  source: ProcessOriginType;
  phase: ActPhase;
  /** Aditivo e opcional (MK3): os atos `APPOINTMENT`/`EXAMINATION` nunca o têm. */
  hint?: BookingHint | null;
  scheduledAt?: Date;
  changedAt: Date;
}

/** Estado visível à família (BR-PRC-02): Marcado / A tratar / Feito / Cancelado. Nunca persistido. */
export type FamilyStatus = "SCHEDULED" | "IN_PROGRESS" | "DONE" | "CANCELLED";

/** "O que falta e de quem" (BR-PRC-03): códigos estruturais; a UI traduz. Conjuntos abertos. */
export type NextStepCode =
  | "AWAIT_CLINIC_RESPONSE"
  | "ATTEND"
  | "BEING_ATTENDED"
  | "RESCHEDULE"
  | "NOTHING_PENDING"
  | "AWAIT_PROFESSIONAL_RESPONSE"
  | "SEND_PAYMENT_PROOF"
  | "AWAIT_PAYMENT_CONFIRMATION"
  | "AWAIT_PAYMENT_DISPUTE_DECISION"
  | "LEAVE_REVIEW";
export type NextStepActor = "FAMILY" | "CLINIC" | "NONE" | "PROFESSIONAL" | "PLATFORM";
export interface NextStep {
  code: NextStepCode;
  actor: NextStepActor;
}

/** Linha do processo (schema.md §4b): sem `family_status`, `nextStep` nem dados clínicos. */
export interface Process {
  id: string;
  familyId: string;
  memberId: string;
  kind: ProcessKind;
  originType: ProcessOriginType;
  originId: string;
  clinicId?: string;
  openedAt: Date;
}

/** O que governa a leitura (authorization.md §6.8): consulta e exame herdam a categoria de dados do ato; a marcação exige READ(APPOINTMENTS) (BR-MKT-55). */
export type OriginCategory = "APPOINTMENTS" | "EXAMS";

export function categoryOfOrigin(originType: ProcessOriginType): OriginCategory {
  return originType === "EXAMINATION" ? "EXAMS" : "APPOINTMENTS";
}
