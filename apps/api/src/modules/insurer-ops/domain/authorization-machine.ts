// A ÚNICA máquina de estados do pedido de autorização (S4 simplificado, state-machines.md, ADR-034): tabela de transições
// com ator e motivo de fecho. Pura (sem imports fora de `domain/`, TC-AUT-19): a camada de aplicação traduz o resultado em
// erro HTTP. Fatia 4 (ADR-035): as transições do analista e do supervisor têm rota; `AUTO_APPROVE` só existe na criação.
// Nunca aprova por silêncio (Q-V2 A): não há transição por decurso de prazo para APPROVED/REJECTED (o único `SYSTEM → APPROVED`
// é a auto-aprovação por regra da seguradora, na criação do pedido, BR-AUT-03).

export const AUTHORIZATION_STATUSES = ["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

/** Quem executa a transição: a clínica (prestador), o analista ou o supervisor da seguradora, ou o sistema (jobs, criação). */
export type TransitionActor = "CLINIC" | "ANALYST" | "SUPERVISOR" | "SYSTEM";

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
  // Auto-aprovação (BR-AUT-03): só na criação de um pedido que não é recurso; o ator é o sistema a executar regras da seguradora.
  { name: "AUTO_APPROVE", from: "SUBMITTED", to: "APPROVED", actor: "SYSTEM" },
  // Quem pode decidir o quê (analista: pedidos normais; supervisor: recursos) é de `authorization-actions.ts`, não da máquina.
  { name: "APPROVE", from: "IN_REVIEW", to: "APPROVED", actor: "ANALYST" },
  { name: "APPROVE", from: "IN_REVIEW", to: "APPROVED", actor: "SUPERVISOR" },
  { name: "REJECT", from: "IN_REVIEW", to: "REJECTED", actor: "ANALYST" },
  { name: "REJECT", from: "IN_REVIEW", to: "REJECTED", actor: "SUPERVISOR" },
  { name: "REQUEST_INFO", from: "IN_REVIEW", to: "INFO_REQUESTED", actor: "ANALYST" },
  { name: "REQUEST_INFO", from: "IN_REVIEW", to: "INFO_REQUESTED", actor: "SUPERVISOR" },
  { name: "ANSWER_INFO", from: "INFO_REQUESTED", to: "IN_REVIEW", actor: "CLINIC" },
  { name: "EXPIRE_INFO", from: "INFO_REQUESTED", to: "CANCELLED", actor: "SYSTEM", closedReason: "INFO_TIMEOUT" },
  { name: "CANCEL_SUBMITTED", from: "SUBMITTED", to: "CANCELLED", actor: "CLINIC", closedReason: "CLINIC_CANCELLED" },
  { name: "CANCEL_IN_REVIEW", from: "IN_REVIEW", to: "CANCELLED", actor: "CLINIC", closedReason: "CLINIC_CANCELLED" },
  { name: "CANCEL_INFO_REQUESTED", from: "INFO_REQUESTED", to: "CANCELLED", actor: "CLINIC", closedReason: "CLINIC_CANCELLED" },
  // BR-SEG-16/BR-AUT-21: reverter uma aprovação (o analista só as suas; o supervisor qualquer: `authorization-actions.ts`).
  { name: "REVERT_APPROVAL", from: "APPROVED", to: "CANCELLED", actor: "ANALYST", closedReason: "ANALYST_CANCELLED" },
  { name: "REVERT_APPROVAL", from: "APPROVED", to: "CANCELLED", actor: "SUPERVISOR", closedReason: "ANALYST_CANCELLED" },
  // BR-AUT-22: só o supervisor reabre uma recusa (dentro do prazo de recurso).
  { name: "REOPEN", from: "REJECTED", to: "IN_REVIEW", actor: "SUPERVISOR" },
];

/** Pendente = ainda a aguardar a seguradora ou a clínica (o pedido «está vivo»; BR-AUT-09/13/15). */
export const PENDING_STATUSES: readonly AuthorizationStatus[] = ["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED"];
/** Finais para todos os atores: só `CANCELLED`. `REJECTED` é final para a clínica, mas o `SUPERVISOR` reabre-o (BR-AUT-22). */
export const FINAL_STATUSES: readonly AuthorizationStatus[] = ["CANCELLED"];
export const FINAL_FOR_CLINIC_STATUSES: readonly AuthorizationStatus[] = ["REJECTED", "CANCELLED"];

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
