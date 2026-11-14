// A ÚNICA máquina de estados do pedido de autorização (S4 simplificado, state-machines.md, ADR-034): tabela de transições
// com ator e motivo de fecho. Pura (sem imports fora de `domain/`, TC-AUT-19): a camada de aplicação traduz o resultado em
// erro HTTP. A fatia 3 só expõe por rota as transições da clínica e do sistema; as do analista (fatia 4) já estão aqui.
// Nunca aprova por silêncio (Q-V2 A): não há transição por decurso de prazo para APPROVED/REJECTED.

export const AUTHORIZATION_STATUSES = ["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

/** Quem executa a transição: a clínica (prestador), o analista da seguradora (fatia 4) ou o sistema (jobs, criação). */
export type TransitionActor = "CLINIC" | "ANALYST" | "SYSTEM";

export interface TransitionRule {
  name: string;
  /** `null` = criação (o pedido ainda não existe). */
  from: AuthorizationStatus | null;
  to: AuthorizationStatus;
  actor: TransitionActor;
  /** Só em `CANCELLED`: o motivo de fecho exigido por esta transição. */
  closedReason?: string;
}

export const AUTHORIZATION_TRANSITIONS: readonly TransitionRule[] = [
  { name: "SUBMIT", from: null, to: "SUBMITTED", actor: "CLINIC" },
  { name: "START_REVIEW", from: "SUBMITTED", to: "IN_REVIEW", actor: "SYSTEM" },
  { name: "APPROVE", from: "IN_REVIEW", to: "APPROVED", actor: "ANALYST" },
  { name: "REJECT", from: "IN_REVIEW", to: "REJECTED", actor: "ANALYST" },
  { name: "REQUEST_INFO", from: "IN_REVIEW", to: "INFO_REQUESTED", actor: "ANALYST" },
  { name: "ANSWER_INFO", from: "INFO_REQUESTED", to: "IN_REVIEW", actor: "CLINIC" },
  { name: "EXPIRE_INFO", from: "INFO_REQUESTED", to: "CANCELLED", actor: "SYSTEM", closedReason: "INFO_TIMEOUT" },
  { name: "CANCEL_SUBMITTED", from: "SUBMITTED", to: "CANCELLED", actor: "CLINIC", closedReason: "CLINIC_CANCELLED" },
  { name: "CANCEL_IN_REVIEW", from: "IN_REVIEW", to: "CANCELLED", actor: "CLINIC", closedReason: "CLINIC_CANCELLED" },
  { name: "CANCEL_INFO_REQUESTED", from: "INFO_REQUESTED", to: "CANCELLED", actor: "CLINIC", closedReason: "CLINIC_CANCELLED" },
  // Fatia 4: o analista reverte uma aprovação (BR-SEG-16); o motivo `ANALYST_CANCELLED` entra na BD por `ADD VALUE` nessa fatia.
  { name: "REVERT_APPROVAL", from: "APPROVED", to: "CANCELLED", actor: "ANALYST", closedReason: "ANALYST_CANCELLED" },
];

/** Pendente = ainda a aguardar a seguradora ou a clínica (o pedido «está vivo»; BR-AUT-09/13/15). */
export const PENDING_STATUSES: readonly AuthorizationStatus[] = ["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED"];
export const FINAL_STATUSES: readonly AuthorizationStatus[] = ["REJECTED", "CANCELLED"];

export const isPending = (status: AuthorizationStatus): boolean => PENDING_STATUSES.includes(status);

export type TransitionCheck =
  | { ok: true; rule: TransitionRule }
  | { ok: false; reason: "ILLEGAL" | "WRONG_ACTOR" | "CLOSED_REASON_REQUIRED" | "CLOSED_REASON_NOT_ALLOWED" };

/** Decide uma transição `from → to` pedida por `actor` (com o motivo de fecho, se for `CANCELLED`). */
export function checkTransition(from: AuthorizationStatus | null, to: AuthorizationStatus, actor: TransitionActor, closedReason?: string): TransitionCheck {
  const candidates = AUTHORIZATION_TRANSITIONS.filter((t) => t.from === from && t.to === to);
  if (candidates.length === 0) return { ok: false, reason: "ILLEGAL" };
  const rule = candidates.find((t) => t.actor === actor);
  if (rule === undefined) return { ok: false, reason: "WRONG_ACTOR" };
  if (rule.closedReason !== undefined && closedReason === undefined) return { ok: false, reason: "CLOSED_REASON_REQUIRED" };
  if (rule.closedReason === undefined && closedReason !== undefined) return { ok: false, reason: "CLOSED_REASON_NOT_ALLOWED" };
  if (rule.closedReason !== undefined && rule.closedReason !== closedReason) return { ok: false, reason: "CLOSED_REASON_NOT_ALLOWED" };
  return { ok: true, rule };
}
