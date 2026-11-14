// Tipos do domínio de `processes` (entities.md "Process", state-machines.md "Process", BR-PRC-01..04).
// Sem I/O e sem importar nada fora de `domain/` (TC-PRC-20).
// Conjuntos abertos: as fatias seguintes acrescentam valores (BR-PRC-10) por `ADD VALUE` na BD e aqui.

/** `ROUTINE` (fatia 1: ato sem seguradora) e `AUTHORIZED` (fatia 3: aberto por um pedido de autorização). */
export type ProcessKind = "ROUTINE" | "AUTHORIZED";

/** O que abriu o processo: um ato (consulta/exame) ou, na fatia 3, um pedido de autorização sem marcação. */
export type ProcessOriginType = "APPOINTMENT" | "EXAMINATION" | "AUTHORIZATION";
export const PROCESS_ORIGIN_TYPES: readonly ProcessOriginType[] = ["APPOINTMENT", "EXAMINATION", "AUTHORIZATION"];

/** `kind` deriva-se da origem (ADR-034): quem abre o processo não o escolhe. */
export function kindOfOrigin(originType: ProcessOriginType): ProcessKind {
  return originType === "AUTHORIZATION" ? "AUTHORIZED" : "ROUTINE";
}

/** Origem sem ato (BR-AUT-01): o estado vem só do facto de cobertura. */
export function hasAct(originType: ProcessOriginType): boolean {
  return originType !== "AUTHORIZATION";
}

/** Fase do ato publicada pelo módulo dono (BR-PRC-04; state-machines.md "Process", projeção 1). */
export type ActPhase = "PENDING" | "SCHEDULED" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "NO_SHOW";
export const ACT_PHASES: readonly ActPhase[] = ["PENDING", "SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED", "NO_SHOW"];

/** Facto pequeno e estável do ato (BR-PRC-04): é tudo o que `processes` sabe do estado de um ato. */
export interface ActFact {
  source: Exclude<ProcessOriginType, "AUTHORIZATION">;
  phase: ActPhase;
  scheduledAt?: Date;
  changedAt: Date;
}

/** Fase de cobertura publicada por quem dono dos pedidos (state-machines.md, Process, tabela 3). */
export type CoveragePhase = "PENDING_DECISION" | "NEEDS_INFO" | "NOT_APPROVED" | "APPROVED" | "CLOSED";
export const COVERAGE_PHASES: readonly CoveragePhase[] = ["PENDING_DECISION", "NEEDS_INFO", "NOT_APPROVED", "APPROVED", "CLOSED"];

/** Facto de cobertura de um processo (ADR-034): `dueAt` só em `PENDING_DECISION` (informativo). */
export interface CoverageFact {
  phase: CoveragePhase;
  dueAt?: Date;
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
  | "AWAIT_INSURER_DECISION"
  | "AWAIT_CLINIC_INFORMATION"
  | "COVERAGE_NOT_APPROVED";
export type NextStepActor = "FAMILY" | "CLINIC" | "INSURER" | "NONE";
export interface NextStep {
  code: NextStepCode;
  actor: NextStepActor;
  /** Só em `AWAIT_INSURER_DECISION` (= `decisionDueAt` do pedido). */
  dueAt?: Date;
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

/**
 * O que governa a leitura (authorization.md §6.8): consulta e exame herdam a categoria de dados do ato; a origem
 * `AUTHORIZATION` não tem categoria de saúde e segue a ação de seguro (`MANAGE_INSURANCE`, §8.5).
 */
export type OriginCategory = "APPOINTMENTS" | "EXAMS" | "INSURANCE";

export function categoryOfOrigin(originType: ProcessOriginType): OriginCategory {
  if (originType === "APPOINTMENT") return "APPOINTMENTS";
  return originType === "EXAMINATION" ? "EXAMS" : "INSURANCE";
}
