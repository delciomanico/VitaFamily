// Vista da seguradora do pedido de autorização (fatia 4, ADR-035; openapi `InsurerAuthorization`): dados da seguradora e da
// clínica, nunca de saúde (C2): sem ids de utilizador/família/membro nem `processId`.
import type { AutoApprovalTrace } from "./auto-approval.js";
import type { AuthorizationDecider } from "./authorization-actions.js";
import type { AuthorizationStatus } from "./authorization-machine.js";
import type { ClosedReason } from "./authorization.js";

export interface InsurerAuthorizationRow {
  id: string;
  insurerId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  providerName: string;
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  serviceKindId: string | null;
  serviceStatus: "ACTIVE" | "INACTIVE";
  guideType: string;
  status: AuthorizationStatus;
  closedReason: ClosedReason | null;
  justification: string;
  requestedAmount: number;
  authorizedAmount: number | null;
  expectedOn: string;
  parentRequestId: string | null;
  decisionNote: string | null;
  code: string | null;
  validUntil: Date | null;
  decisionDueAt: Date;
  infoExpiresAt: Date | null;
  escalatedAt: Date | null;
  assignedTo: { id: string; email: string } | null;
  decidedByKind: AuthorizationDecider | null;
  decidedByAccountId: string | null;
  decidedAt: Date | null;
  autoApprovalTrace: AutoApprovalTrace | null;
  hasLiveAppeal: boolean;
  /** Recurso: quem decidiu a recusa de origem (separação de funções, BR-AUT-18). */
  originDeciderAccountId: string | null;
  /** Pedido reaberto: quem o recusou antes (BR-AUT-22). */
  priorRejecterAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsurerAuthorizationEventRow {
  toStatus: AuthorizationStatus;
  actorType: "CLINIC_ACCOUNT" | "INSURANCE_ACCOUNT" | "SYSTEM";
  actorRole: "ANALYST" | "SUPERVISOR" | null;
  note: string | null;
  internalNote: string | null;
  occurredAt: Date;
}

export type AssignedFilter = "ME" | "UNASSIGNED" | "ANY";
export type QueueSort = "DUE" | "RECENT";

export interface InsurerQueueFilter {
  /** `OPEN` (por omissão) = `IN_REVIEW` e `INFO_REQUESTED`. */
  status: AuthorizationStatus | "OPEN";
  assigned: AssignedFilter;
  overdue?: boolean;
  escalated?: boolean;
  appeal?: boolean;
  decidedBy?: AuthorizationDecider;
  sort: QueueSort;
  now: Date;
  accountId: string;
}

/** Cursor da fila: o instante da ordenação (`decisionDueAt` ou `updatedAt`) e o `id` (desempate estável). */
export interface QueueCursor {
  at: string;
  id: string;
}

export interface SlaMetricsCounts {
  open: { total: number; unassigned: number; overdue: number; escalated: number; infoRequested: number };
  period: { decided: number; approved: number; rejected: number; autoApproved: number; decidedWithinSla: number; medianDecisionHours: number | null };
}
