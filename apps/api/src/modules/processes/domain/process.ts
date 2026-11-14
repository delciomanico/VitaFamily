// Tipos do domínio de `processes` (entities.md "Process", state-machines.md "Process", BR-PRC-01..04).
// Sem I/O e sem importar nada fora de `domain/` (TC-PRC-20).
// Conjuntos abertos: as fatias seguintes acrescentam valores (BR-PRC-10) por `ADD VALUE` na BD e aqui.

/** Fatia 1: só `ROUTINE` (ato sem seguradora). */
export type ProcessKind = "ROUTINE";

/** Ato que abriu o processo. */
export type ProcessOriginType = "APPOINTMENT" | "EXAMINATION";
export const PROCESS_ORIGIN_TYPES: readonly ProcessOriginType[] = ["APPOINTMENT", "EXAMINATION"];

/** Fase do ato publicada pelo módulo dono (BR-PRC-04; state-machines.md "Process", projeção 1). */
export type ActPhase = "PENDING" | "SCHEDULED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "NO_SHOW";
export const ACT_PHASES: readonly ActPhase[] = ["PENDING", "SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED", "NO_SHOW"];

/** Facto pequeno e estável do ato (BR-PRC-04): é tudo o que `processes` sabe do estado de um ato. */
export interface ActFact {
  source: ProcessOriginType;
  phase: ActPhase;
  scheduledAt?: Date;
  changedAt: Date;
}

/** Estado visível à família (BR-PRC-02): Marcado / A tratar / Feito / Cancelado. Nunca persistido. */
export type FamilyStatus = "SCHEDULED" | "IN_PROGRESS" | "DONE" | "CANCELLED";

/** "O que falta e de quem" (BR-PRC-03): códigos estruturais; a UI traduz. Conjuntos abertos. */
export type NextStepCode = "AWAIT_CLINIC_RESPONSE" | "ATTEND" | "BEING_ATTENDED" | "RESCHEDULE" | "NOTHING_PENDING";
export type NextStepActor = "FAMILY" | "CLINIC" | "NONE";
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

/** Categoria de dados (authorization.md §6.8): o processo herda a da origem. */
export type OriginCategory = "APPOINTMENTS" | "EXAMS";

export function categoryOfOrigin(originType: ProcessOriginType): OriginCategory {
  return originType === "APPOINTMENT" ? "APPOINTMENTS" : "EXAMS";
}
