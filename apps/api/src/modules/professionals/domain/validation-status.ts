// Máquina de estados de validação do `Professional` (BR-MKT-15..21, state-machines.md «Professional») e matriz de escrita por estado
// (BR-MKT-23, authorization.md §10.2). Funções puras, sem I/O; o estado vive na BD e lê-se por pedido (BR-MKT-29).
import { ValidationError } from "../../../platform/errors/index.js";
import { charLength } from "./text.js";
import { InvalidStateTransitionError, ProfessionalLockedError } from "./errors.js";

function validationReasonError(message: string): ValidationError {
  return new ValidationError([{ field: "reason", message }], { detail: "Motivo inválido." });
}

export const PROFESSIONAL_VALIDATION_STATUSES = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED", "SUSPENDED"] as const;
export type ProfessionalValidationStatus = (typeof PROFESSIONAL_VALIDATION_STATUSES)[number];

export type ProfessionalDecision = "APPROVE" | "REJECT" | "REQUEST_INFO" | "SUSPEND" | "REACTIVATE";
export type ValidationAction = "SUBMITTED" | "APPROVED" | "REJECTED" | "NEEDS_INFO" | "SUSPENDED" | "REACTIVATED" | "EXPIRED";
export type ValidationActor = "PROFESSIONAL" | "PLATFORM_ADMIN" | "SYSTEM";

export interface Transition {
  from: ProfessionalValidationStatus;
  to: ProfessionalValidationStatus;
  action: ValidationAction;
  actor: ValidationActor;
  /** BR-MKT-18: `reason` obrigatório (também exigido pela CHECK de `validation_cases`). */
  reasonRequired: boolean;
  /** BR-MKT-16: `APPROVE`/`REACTIVATE`/submissão exigem os requisitos cumpridos. */
  requiresRequirements: boolean;
}

interface DecisionRow {
  from: readonly ProfessionalValidationStatus[];
  to: ProfessionalValidationStatus;
  action: ValidationAction;
  reasonRequired: boolean;
  requiresRequirements: boolean;
}

/** Tabela de decisões do admin (state-machines.md): única via de decisão. */
const DECISIONS: Record<ProfessionalDecision, DecisionRow> = {
  APPROVE: { from: ["PENDING_REVIEW"], to: "APPROVED", action: "APPROVED", reasonRequired: false, requiresRequirements: true },
  REJECT: { from: ["PENDING_REVIEW"], to: "REJECTED", action: "REJECTED", reasonRequired: true, requiresRequirements: false },
  REQUEST_INFO: { from: ["PENDING_REVIEW", "APPROVED", "REJECTED"], to: "NEEDS_INFO", action: "NEEDS_INFO", reasonRequired: true, requiresRequirements: false },
  SUSPEND: { from: ["APPROVED"], to: "SUSPENDED", action: "SUSPENDED", reasonRequired: true, requiresRequirements: false },
  REACTIVATE: { from: ["SUSPENDED"], to: "APPROVED", action: "REACTIVATED", reasonRequired: false, requiresRequirements: true },
};

/** Decisão do admin; estado fora de `from` ⇒ `INVALID_STATE_TRANSITION` (inclui a corrida em que outro admin já decidiu). */
export function decideTransition(from: ProfessionalValidationStatus, decision: ProfessionalDecision): Transition {
  const row = DECISIONS[decision];
  if (!row.from.includes(from)) {
    throw new InvalidStateTransitionError();
  }
  return { from, to: row.to, action: row.action, actor: "PLATFORM_ADMIN", reasonRequired: row.reasonRequired, requiresRequirements: row.requiresRequirements };
}

/** Só o profissional submete (`DRAFT`/`NEEDS_INFO` → `PENDING_REVIEW`). */
export function submitTransition(from: ProfessionalValidationStatus): Transition {
  if (from !== "DRAFT" && from !== "NEEDS_INFO") {
    throw new InvalidStateTransitionError();
  }
  return { from, to: "PENDING_REVIEW", action: "SUBMITTED", actor: "PROFESSIONAL", reasonRequired: false, requiresRequirements: true };
}

/** Caducidade (BR-MKT-21): só `APPROVED` → `NEEDS_INFO`, ator `SYSTEM`, motivo fixo. */
export const EXPIRY_REASON = "Credencial caducada.";
export function expireTransition(from: ProfessionalValidationStatus): Transition {
  if (from !== "APPROVED") {
    throw new InvalidStateTransitionError();
  }
  return { from, to: "NEEDS_INFO", action: "EXPIRED", actor: "SYSTEM", reasonRequired: true, requiresRequirements: false };
}

/**
 * Motivo de uma decisão (BR-MKT-18): obrigatório conforme a tabela; aparado; ≤ 500. Devolve `null` se ausente/vazio e opcional.
 * Nunca é auditado nem registado em logs (só vai a `validation_cases`/`status_reason`).
 */
export function normalizeDecisionReason(transition: Pick<Transition, "reasonRequired">, reason: string | undefined | null): string | null {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length === 0) {
    if (transition.reasonRequired) {
      throw validationReasonError("O motivo é obrigatório.");
    }
    return null;
  }
  if (charLength(trimmed) > 500) {
    throw validationReasonError("O motivo tem no máximo 500 caracteres.");
  }
  return trimmed;
}


/** Operações de escrita do profissional (authorization.md §10.2). Leituras e login nunca estão bloqueados (OP-59). */
export type ProfessionalWriteOperation = "EDIT_IDENTITY" | "EDIT_FREE_PROFILE" | "EDIT_COMMERCIAL";

const IDENTITY_EDITABLE: readonly ProfessionalValidationStatus[] = ["DRAFT", "NEEDS_INFO"];
const WRITABLE: readonly ProfessionalValidationStatus[] = ["DRAFT", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED"];

/**
 * Matriz estado × operação (BR-MKT-23): `EDIT_IDENTITY` (displayName, especialidades, credenciais) só em DRAFT/NEEDS_INFO;
 * `EDIT_FREE_PROFILE` (bio, city, paymentInstructions) e `EDIT_COMMERCIAL` (ofertas, regras, bloqueios) em todos exceto REJECTED/SUSPENDED.
 */
export function canWrite(status: ProfessionalValidationStatus, operation: ProfessionalWriteOperation): boolean {
  return (operation === "EDIT_IDENTITY" ? IDENTITY_EDITABLE : WRITABLE).includes(status);
}

export function assertCanWrite(status: ProfessionalValidationStatus, operation: ProfessionalWriteOperation): void {
  if (!canWrite(status, operation)) {
    throw new ProfessionalLockedError();
  }
}

/** Geração de horários e visibilidade a famílias: só `APPROVED` (BR-MKT-19/25). */
export function isVisible(status: ProfessionalValidationStatus): boolean {
  return status === "APPROVED";
}
