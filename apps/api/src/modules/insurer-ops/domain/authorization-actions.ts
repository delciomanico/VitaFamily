// Matriz fina da decisão de autorizações (authorization.md §8.2d, BR-AUT-17/18/21/22): quem pode fazer o quê, neste pedido, agora.
// Pura, sem imports fora de `domain/`: `checkAction` devolve a categoria do erro (a `application` traduz em 403/409) e
// `acoesPermitidas` é a MESMA decisão aplicada a todas as ações (a UI mostra só estes botões). O analista decide pedidos que não
// são recurso; o supervisor decide só recursos, reatribui, reabre e reverte; Admin/Claims/Finance só leem.
import type { AuthorizationStatus } from "./authorization-machine.js";

export type DecisionRole = "INSURANCE_ADMIN" | "INSURANCE_AGENT" | "BENEFICIARY_MANAGER" | "AUTHORIZATION_ANALYST" | "CLAIMS_MANAGER" | "FINANCE_MANAGER" | "SUPERVISOR";
export type InsurerAuthorizationAction = "ASSIGN" | "UNASSIGN" | "APPROVE" | "REJECT" | "REQUEST_INFO" | "CANCEL" | "REOPEN" | "DOWNLOAD_ATTACHMENT";
export type AuthorizationDecider = "ANALYST" | "SUPERVISOR" | "SYSTEM";

/** O que as regras precisam saber do pedido (sem dados pessoais). */
export interface ActionSubject {
  status: AuthorizationStatus;
  isAppeal: boolean;
  assignedToAccountId: string | null;
  decidedByKind: AuthorizationDecider | null;
  decidedByAccountId: string | null;
  /** Recurso: quem decidiu a recusa de que nasceu (separação de funções). */
  originDeciderAccountId: string | null;
  /** Pedido reaberto: quem o recusou antes (não volta a decidi-lo). */
  priorRejecterAccountId: string | null;
  /** `REJECTED` dentro do prazo de recurso (`appealOpenUntil` ainda não passou). */
  appealWindowOpen: boolean;
  hasLiveAppeal: boolean;
}

export interface ActionActor {
  role: DecisionRole;
  accountId: string;
}

/** `FORBIDDEN` ⇒ 403; `INVALID_STATE` ⇒ 409 INVALID_STATE_TRANSITION; `CONFLICT` ⇒ 409 CONFLICT. */
export type ActionCheck = { ok: true } | { ok: false; error: "FORBIDDEN" | "INVALID_STATE" | "CONFLICT" };

const OK: ActionCheck = { ok: true };
const no = (error: "FORBIDDEN" | "INVALID_STATE" | "CONFLICT"): ActionCheck => ({ ok: false, error });

export const READ_ONLY_ROLES: readonly DecisionRole[] = ["INSURANCE_ADMIN", "CLAIMS_MANAGER", "FINANCE_MANAGER"];

/** Decide uma ação. Ordem: papel e função (403) → estado (409) → atribuição (409 CONFLICT). */
export function checkAction(action: InsurerAuthorizationAction, actor: ActionActor, subject: ActionSubject): ActionCheck {
  const isAnalyst = actor.role === "AUTHORIZATION_ANALYST";
  const isSupervisor = actor.role === "SUPERVISOR";
  if (!isAnalyst && !isSupervisor) return no("FORBIDDEN");

  switch (action) {
    case "DOWNLOAD_ATTACHMENT":
      return OK;
    case "APPROVE":
    case "REJECT":
    case "REQUEST_INFO": {
      // Analista só pedidos normais; supervisor só recursos (BR-AUT-18).
      if (isAnalyst === subject.isAppeal) return no("FORBIDDEN");
      // Separação de funções: quem decidiu a recusa de origem, ou quem recusou este pedido antes de ser reaberto, não decide.
      if (subject.originDeciderAccountId === actor.accountId || subject.priorRejecterAccountId === actor.accountId) return no("FORBIDDEN");
      if (subject.status !== "IN_REVIEW") return no("INVALID_STATE");
      if (isAnalyst && subject.assignedToAccountId !== null && subject.assignedToAccountId !== actor.accountId) return no("CONFLICT");
      return OK;
    }
    case "ASSIGN": {
      // Os recursos não se atribuem; o analista só toma um pedido `IN_REVIEW` livre (ou já seu); o supervisor também `INFO_REQUESTED`.
      if (subject.isAppeal) return no("INVALID_STATE");
      if (isAnalyst) {
        // Quem recusou o pedido antes de ser reaberto não volta a ficar com ele (BR-AUT-22).
        if (subject.priorRejecterAccountId === actor.accountId) return no("FORBIDDEN");
        if (subject.status !== "IN_REVIEW") return no("INVALID_STATE");
        return subject.assignedToAccountId === null || subject.assignedToAccountId === actor.accountId ? OK : no("CONFLICT");
      }
      return subject.status === "IN_REVIEW" || subject.status === "INFO_REQUESTED" ? OK : no("INVALID_STATE");
    }
    case "UNASSIGN":
      if (!isSupervisor) return no("FORBIDDEN");
      if (subject.isAppeal || (subject.status !== "IN_REVIEW" && subject.status !== "INFO_REQUESTED")) return no("INVALID_STATE");
      return subject.assignedToAccountId === null ? no("INVALID_STATE") : OK;
    case "CANCEL": {
      if (subject.status !== "APPROVED") return no("INVALID_STATE");
      // O analista só reverte decisões manuais de analista; a automática (`SYSTEM`) é só do supervisor (BR-AUT-21).
      return isSupervisor || subject.decidedByKind === "ANALYST" ? OK : no("FORBIDDEN");
    }
    case "REOPEN": {
      if (!isSupervisor) return no("FORBIDDEN");
      // §8.2d: não se foi quem a recusou.
      if (subject.decidedByAccountId === actor.accountId) return no("FORBIDDEN");
      if (subject.status !== "REJECTED" || !subject.appealWindowOpen) return no("INVALID_STATE");
      return subject.hasLiveAppeal ? no("CONFLICT") : OK;
    }
  }
}

const ALL_ACTIONS: readonly InsurerAuthorizationAction[] = ["ASSIGN", "UNASSIGN", "APPROVE", "REJECT", "REQUEST_INFO", "CANCEL", "REOPEN", "DOWNLOAD_ATTACHMENT"];

/** Ações que o servidor permite AGORA a este papel neste pedido. */
export function acoesPermitidas(actor: ActionActor, subject: ActionSubject): InsurerAuthorizationAction[] {
  return ALL_ACTIONS.filter((action) => checkAction(action, actor, subject).ok);
}
