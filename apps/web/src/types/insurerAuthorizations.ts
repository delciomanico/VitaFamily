/**
 * Decisão pela seguradora (marco B fatia 4, ADR-035): fila, detalhe, decisão, atribuição, métricas de prazo e regras de
 * aprovação automática. Tipos escritos à mão a partir de `docs/05-api/openapi.yaml` (`InsurerAuthorization*`, `AutoApprovalRule`,
 * `AuthorizationSlaMetrics`); o web não gera tipos do OpenAPI. Nunca inclui ids de utilizador/família/membro nem dados clínicos (C2).
 */
import type { AuthorizationAttachment, AuthorizationStatus } from './insurerOps'

export type AuthorizationDecider = 'ANALYST' | 'SUPERVISOR' | 'SYSTEM'
export type AuthorizationSlaStatus = 'ON_TIME' | 'OVERDUE' | 'MET' | 'MISSED'
export type InsurerAuthorizationAction = 'ASSIGN' | 'UNASSIGN' | 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'CANCEL' | 'REOPEN' | 'DOWNLOAD_ATTACHMENT'
export type InsurerClosedReason = 'INFO_TIMEOUT' | 'CLINIC_CANCELLED' | 'ANALYST_CANCELLED'

export interface AutoApprovalCheck {
  check: string
  ok: boolean
  reason: string
}

/** Rasto de `podeAutoAprovar` (só códigos): mostra-se ao analista/supervisor, nunca à clínica. */
export interface AutoApprovalTrace {
  ok: boolean
  ruleId?: string | null
  ruleName?: string | null
  checks: AutoApprovalCheck[]
}

export interface AuthorizationAssignee {
  id: string
  email: string
}

export interface InsurerAuthorization {
  id: string
  status: AuthorizationStatus
  closedReason?: InsurerClosedReason | null
  guideType: string
  serviceCode: string
  serviceName: string
  providerName: string
  beneficiaryId: string
  beneficiaryName: string
  currency: string
  requestedAmount: number
  authorizedAmount?: number | null
  partial: boolean
  expectedOn: string
  justification: string
  parentRequestId?: string | null
  isAppeal: boolean
  decisionNote?: string | null
  code?: string | null
  validUntil?: string | null
  expired: boolean
  decisionDueAt: string
  slaStatus?: AuthorizationSlaStatus | null
  escalatedAt?: string | null
  infoExpiresAt?: string | null
  assignedTo?: AuthorizationAssignee | null
  decidedBy?: AuthorizationDecider | null
  decidedAt?: string | null
  autoApproval?: AutoApprovalTrace | null
  allowedActions: InsurerAuthorizationAction[]
  createdAt: string
  updatedAt: string
}

/** `evaluateCoverage` em `expectedOn` (razão INTERNA: só analista e supervisor). */
export interface InsurerAuthorizationCoverage {
  reason: string
  copayPct: number
  requiresAuthorization: boolean
  waitingEndsOn?: string | null
  limitPerYear?: number | null
  remaining?: number | null
}

export interface InsurerTimelineEntry {
  status: AuthorizationStatus
  occurredAt: string
  by: 'CLINIC' | 'ANALYST' | 'SUPERVISOR' | 'SYSTEM'
  note?: string | null
  /** Só seguradora (`overrideReason`, motivo de reabertura). */
  internalNote?: string | null
}

export interface InsurerAuthorizationDetail extends InsurerAuthorization {
  coverage: InsurerAuthorizationCoverage
  attachments: AuthorizationAttachment[]
  timeline: InsurerTimelineEntry[]
}

export interface InsurerAuthorizationQuery {
  status?: AuthorizationStatus | 'OPEN'
  assigned?: 'ME' | 'UNASSIGNED' | 'ANY'
  overdue?: boolean
  escalated?: boolean
  appeal?: boolean
  decidedBy?: AuthorizationDecider
  sort?: 'DUE' | 'RECENT'
  cursor?: string
}

export interface ApproveInput {
  authorizedAmount?: number
  validUntil?: string
  note?: string
  overrideReason?: string
}

export interface AuthorizationSlaMetrics {
  open: { total: number; unassigned: number; overdue: number; escalated: number; infoRequested: number }
  period: {
    from: string
    to: string
    decided: number
    approved: number
    rejected: number
    autoApproved: number
    decidedWithinSla: number
    slaMetPct?: number | null
    autoApprovedPct?: number | null
    medianDecisionHours?: number | null
  }
}

export interface AutoApprovalRule {
  id: string
  name: string
  scope: 'SERVICE_KIND' | 'SERVICE'
  serviceKindId?: string | null
  serviceId?: string | null
  targetName: string
  maxAmount: number
  currency: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface AutoApprovalRuleInput {
  name: string
  serviceKindId?: string
  serviceId?: string
  maxAmount: number
  active?: boolean
}

export interface AutoApprovalRulePatch {
  name?: string
  maxAmount?: number
  active?: boolean
}

/** Tipo de serviço da seguradora (`GET /insurance-portal/service-kinds`, fatia 2): alvo possível de uma regra. */
export interface InsurerServiceKind {
  id: string
  code: string
  name: string
  status: 'ACTIVE' | 'INACTIVE'
}
