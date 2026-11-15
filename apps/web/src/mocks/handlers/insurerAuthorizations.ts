import { AppError } from '@/lib/errors'
import type { AuthorizationAttachment, AuthorizationRequest, Page } from '@/types/insurerOps'
import type {
  ApproveInput,
  AuthorizationAssignee,
  AuthorizationDecider,
  AuthorizationSlaMetrics,
  AuthorizationSlaStatus,
  AutoApprovalRule,
  AutoApprovalRuleInput,
  AutoApprovalRulePatch,
  AutoApprovalTrace,
  InsurerAuthorization,
  InsurerAuthorizationAction,
  InsurerAuthorizationCoverage,
  InsurerAuthorizationDetail,
  InsurerAuthorizationQuery,
  InsurerServiceKind,
  InsurerTimelineEntry,
} from '@/types/insurerAuthorizations'
import { db, newId } from '../db'
import type { MockDecisionMeta } from '../data/insurerOps'
import { respond, respondBlob } from '../respond'
import { policyCoverages } from './clinicInsurers'

/**
 * Decisão pela seguradora (`/insurance-portal/authorizations*` e `/auto-approval-rules*`, ADR-035). Reproduz o contrato: o analista decide
 * pedidos que NÃO são recurso; o supervisor decide só recursos, reatribui, reabre e reverte; Admin/Gestores só leem; módulo desativado ⇒
 * NOT_FOUND; outro papel ⇒ FORBIDDEN; separação de funções; nunca aprova por silêncio (o prazo só marca). Os prazos e a validade são
 * valores por omissão do Vita (a política em dados é do servidor).
 */
export const DECISION_HOURS = 48
export const APPEAL_RESPONSE_HOURS = 72
export const APPEAL_REQUEST_DAYS = 15
export const INFO_EXPIRY_DAYS = 7
export const VALIDITY_DAYS = 30
export const MAX_RULES = 100
export const DEFAULT_LIMIT = 25

type Stored = (typeof db.insurerOps.authorizations)[number]
type Role = 'INSURANCE_ADMIN' | 'INSURANCE_AGENT' | 'BENEFICIARY_MANAGER' | 'AUTHORIZATION_ANALYST' | 'CLAIMS_MANAGER' | 'FINANCE_MANAGER' | 'SUPERVISOR'
type Access = 'read' | 'decide' | 'assignees' | 'rules-read' | 'rules-write'
interface Actor { accountId: string; insurerId: string; role: Role }

const ROLES: Record<Access, Role[]> = {
  read: ['INSURANCE_ADMIN', 'AUTHORIZATION_ANALYST', 'CLAIMS_MANAGER', 'FINANCE_MANAGER', 'SUPERVISOR'],
  decide: ['AUTHORIZATION_ANALYST', 'SUPERVISOR'],
  assignees: ['INSURANCE_ADMIN', 'SUPERVISOR'],
  'rules-read': ['INSURANCE_ADMIN', 'AUTHORIZATION_ANALYST', 'SUPERVISOR'],
  'rules-write': ['SUPERVISOR'],
}

function actorOf(accountId: string, access: Access): Actor {
  const account = db.insuranceAccounts.find((a) => a.id === accountId && a.status === 'ACTIVE')
  if (!account) throw new AppError('INVALID_CREDENTIALS')
  if (!db.insurerOps.modules[account.insurerId]?.enabled) throw new AppError('NOT_FOUND')
  if (!ROLES[access].includes(account.role)) throw new AppError('FORBIDDEN')
  return { accountId, insurerId: account.insurerId, role: account.role }
}

const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 3_600_000).toISOString()
const endOfDay = (day: string, plusDays: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + (plusDays + 1) * 86_400_000 - 1).toISOString()
const code = () => `AUT-${newId('c').slice(-8).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`

function paginate<T>(all: T[], limit = DEFAULT_LIMIT, cursor?: string): Page<T> {
  if (limit < 1 || limit > 100) throw new AppError('VALIDATION_ERROR')
  const start = cursor ? Number(cursor) : 0
  if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
  return { items: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null }
}

/** Dados só da seguradora; criados à primeira utilização a partir da linha do tempo da clínica. */
function metaOf(a: Stored): MockDecisionMeta {
  let meta = db.insurerOps.decisions[a.id]
  if (!meta) {
    meta = {
      assignedToId: null,
      decidedBy: null,
      decidedByAccountId: null,
      escalatedAt: null,
      autoApproval: null,
      originDeciderId: a.parentRequestId ? (db.insurerOps.decisions[a.parentRequestId]?.decidedByAccountId ?? null) : null,
      priorRejecterId: null,
      events: (a.timeline ?? []).map((e) => ({ status: e.status, occurredAt: e.occurredAt, by: e.by === 'INSURER' ? 'ANALYST' : e.by, note: e.note ?? null, internalNote: null })),
    }
    db.insurerOps.decisions[a.id] = meta
  }
  return meta
}

function owned(actor: Actor, id: string): Stored {
  const found = db.insurerOps.authorizations.find((a) => a.id === id && a.insurerId === actor.insurerId)
  if (!found) throw new AppError('NOT_FOUND')
  return found
}

function hasLiveAppeal(a: Stored) {
  return db.insurerOps.authorizations.some((c) => c.parentRequestId === a.id && c.status !== 'CANCELLED')
}

function appealOpen(a: Stored, now: Date) {
  const decidedAt = a.originalDecisionAt ?? a.updatedAt
  return a.status === 'REJECTED' && now.getTime() <= new Date(decidedAt).getTime() + APPEAL_REQUEST_DAYS * 86_400_000
}

type Check = 'OK' | 'FORBIDDEN' | 'INVALID_STATE' | 'CONFLICT'

/** Matriz §8.2d: a mesma decisão para executar e para `allowedActions`. */
function check(action: InsurerAuthorizationAction, actor: Actor, a: Stored, now: Date): Check {
  const meta = metaOf(a)
  const isAnalyst = actor.role === 'AUTHORIZATION_ANALYST'
  const isSupervisor = actor.role === 'SUPERVISOR'
  if (!isAnalyst && !isSupervisor) return 'FORBIDDEN'
  const isAppeal = Boolean(a.parentRequestId)
  switch (action) {
    case 'DOWNLOAD_ATTACHMENT':
      return 'OK'
    case 'APPROVE':
    case 'REJECT':
    case 'REQUEST_INFO':
      if (isAnalyst === isAppeal) return 'FORBIDDEN'
      if (meta.originDeciderId === actor.accountId || meta.priorRejecterId === actor.accountId) return 'FORBIDDEN'
      if (a.status !== 'IN_REVIEW') return 'INVALID_STATE'
      if (isAnalyst && meta.assignedToId && meta.assignedToId !== actor.accountId) return 'CONFLICT'
      return 'OK'
    case 'ASSIGN':
      if (isAppeal) return 'INVALID_STATE'
      if (isAnalyst) {
        if (meta.priorRejecterId === actor.accountId) return 'FORBIDDEN'
        if (a.status !== 'IN_REVIEW') return 'INVALID_STATE'
        return !meta.assignedToId || meta.assignedToId === actor.accountId ? 'OK' : 'CONFLICT'
      }
      return a.status === 'IN_REVIEW' || a.status === 'INFO_REQUESTED' ? 'OK' : 'INVALID_STATE'
    case 'UNASSIGN':
      if (!isSupervisor) return 'FORBIDDEN'
      return !isAppeal && (a.status === 'IN_REVIEW' || a.status === 'INFO_REQUESTED') && meta.assignedToId ? 'OK' : 'INVALID_STATE'
    case 'CANCEL':
      if (a.status !== 'APPROVED') return 'INVALID_STATE'
      return isSupervisor || meta.decidedBy === 'ANALYST' ? 'OK' : 'FORBIDDEN'
    case 'REOPEN':
      if (!isSupervisor) return 'FORBIDDEN'
      if (meta.decidedByAccountId === actor.accountId) return 'FORBIDDEN'
      if (a.status !== 'REJECTED' || !appealOpen(a, now)) return 'INVALID_STATE'
      return hasLiveAppeal(a) ? 'CONFLICT' : 'OK'
  }
}

const ALL: InsurerAuthorizationAction[] = ['ASSIGN', 'UNASSIGN', 'APPROVE', 'REJECT', 'REQUEST_INFO', 'CANCEL', 'REOPEN', 'DOWNLOAD_ATTACHMENT']

function allow(action: InsurerAuthorizationAction, actor: Actor, a: Stored, now: Date) {
  const result = check(action, actor, a, now)
  if (result === 'FORBIDDEN') throw new AppError('FORBIDDEN')
  if (result === 'CONFLICT') throw new AppError('CONFLICT')
  if (result === 'INVALID_STATE') throw new AppError('INVALID_STATE_TRANSITION')
}

function slaOf(a: Stored, meta: MockDecisionMeta, now: Date): AuthorizationSlaStatus | null {
  const due = new Date(a.decisionDueAt ?? a.createdAt).getTime()
  if (a.status === 'IN_REVIEW') return due <= now.getTime() ? 'OVERDUE' : 'ON_TIME'
  if ((a.status === 'APPROVED' || a.status === 'REJECTED') && meta.decidedByAccountId !== undefined) {
    const decided = new Date(a.originalDecisionAt ?? a.updatedAt).getTime()
    return decided <= due ? 'MET' : 'MISSED'
  }
  return null
}

function emailOf(accountId: string | null): AuthorizationAssignee | null {
  const account = accountId ? db.insuranceAccounts.find((a) => a.id === accountId) : undefined
  return account ? { id: account.id, email: account.email } : null
}

function toView(actor: Actor, a: Stored, now: Date): InsurerAuthorization {
  const meta = metaOf(a)
  const approved = a.status === 'APPROVED'
  const actions = ALL.filter((action) => check(action, actor, a, now) === 'OK')
  return {
    id: a.id,
    status: a.status,
    closedReason: a.closedReason ?? null,
    guideType: a.guideType,
    serviceCode: a.serviceCode,
    serviceName: a.serviceName,
    providerName: db.insurerOps.providers.find((p) => p.insurerId === a.insurerId && p.clinicId === a.clinicId)?.name ?? 'Clínica',
    beneficiaryId: a.beneficiaryId,
    beneficiaryName: a.beneficiaryName,
    currency: a.currency,
    requestedAmount: a.requestedAmount,
    authorizedAmount: approved ? (a.authorizedAmount ?? null) : null,
    partial: approved && a.authorizedAmount != null && a.authorizedAmount < a.requestedAmount,
    expectedOn: a.expectedOn,
    justification: a.justification,
    parentRequestId: a.parentRequestId ?? null,
    isAppeal: Boolean(a.parentRequestId),
    decisionNote: a.decisionNote ?? null,
    code: approved ? (a.code ?? null) : null,
    validUntil: approved ? (a.validUntil ?? null) : null,
    expired: approved && Boolean(a.validUntil) && new Date(a.validUntil as string).getTime() < now.getTime(),
    decisionDueAt: a.decisionDueAt ?? a.createdAt,
    slaStatus: slaOf(a, meta, now),
    escalatedAt: meta.escalatedAt,
    infoExpiresAt: a.infoExpiresAt ?? null,
    assignedTo: emailOf(meta.assignedToId),
    decidedBy: meta.decidedBy,
    decidedAt: approved || a.status === 'REJECTED' ? (a.originalDecisionAt ?? a.updatedAt) : null,
    autoApproval: meta.autoApproval,
    allowedActions: actions,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

/** Cobertura em `expectedOn` do mock (razão INTERNA): só o que o plano do beneficiário diz, com carência (BR-SEG-04). */
function coverageOf(a: Stored): InsurerAuthorizationCoverage {
  const holder = db.insurerOps.beneficiaries.find((b) => b.id === a.beneficiaryId)
  const policy = db.insurerOps.policies.find((p) => p.insurerId === a.insurerId && p.holderId === (holder?.holderId ?? holder?.id) && p.status === 'ACTIVE')
  const line = policy ? policyCoverages(policy, a.expectedOn, a.serviceCode)[0] : undefined
  if (!line) return { reason: 'NOT_IN_PLAN', copayPct: 0, requiresAuthorization: false, waitingEndsOn: null, limitPerYear: null, remaining: null }
  return {
    reason: line.coveredNow ? 'COVERED' : 'WAITING_PERIOD',
    copayPct: line.copayPct,
    requiresAuthorization: line.requiresAuthorization,
    waitingEndsOn: line.waitingEndsOn ?? null,
    limitPerYear: line.limitPerYear ?? null,
    remaining: line.limitPerYear ?? null,
  }
}

function toDetail(actor: Actor, a: Stored, now: Date): InsurerAuthorizationDetail {
  const meta = metaOf(a)
  return { ...toView(actor, a, now), coverage: coverageOf(a), attachments: structuredClone(a.attachments ?? []) as AuthorizationAttachment[], timeline: structuredClone(meta.events) }
}

function log(a: Stored, entry: InsurerTimelineEntry, clinicBy: 'CLINIC' | 'INSURER' | 'SYSTEM' | null, now: Date) {
  metaOf(a).events.push(entry)
  if (clinicBy) a.timeline = [...(a.timeline ?? []), { status: entry.status, occurredAt: entry.occurredAt, by: clinicBy, note: entry.note ?? null }]
  a.updatedAt = now.toISOString()
}

// --- Leitura ---

export function listAuthorizations(accountId: string, query: InsurerAuthorizationQuery = {}, now: Date = new Date()) {
  return respond((): Page<InsurerAuthorization> => {
    const actor = actorOf(accountId, 'read')
    const status = query.status ?? 'OPEN'
    const all = db.insurerOps.authorizations
      .filter((a) => a.insurerId === actor.insurerId && a.status !== 'SUBMITTED')
      .filter((a) => (status === 'OPEN' ? a.status === 'IN_REVIEW' || a.status === 'INFO_REQUESTED' : a.status === status))
      .filter((a) => {
        const meta = metaOf(a)
        if (query.assigned === 'ME' && meta.assignedToId !== accountId) return false
        if (query.assigned === 'UNASSIGNED' && meta.assignedToId) return false
        if (query.overdue && !(a.status === 'IN_REVIEW' && slaOf(a, meta, now) === 'OVERDUE')) return false
        if (query.escalated !== undefined && Boolean(meta.escalatedAt) !== query.escalated) return false
        if (query.appeal !== undefined && Boolean(a.parentRequestId) !== query.appeal) return false
        if (query.decidedBy && meta.decidedBy !== query.decidedBy) return false
        return true
      })
      .sort((x, y) => (query.sort === 'RECENT' ? y.updatedAt.localeCompare(x.updatedAt) : (x.decisionDueAt ?? '').localeCompare(y.decisionDueAt ?? '') || x.id.localeCompare(y.id)))
    const page = paginate(all, DEFAULT_LIMIT, query.cursor)
    return { items: page.items.map((a) => toView(actor, a, now)), nextCursor: page.nextCursor }
  })
}

export function getAuthorization(accountId: string, id: string, now: Date = new Date()) {
  return respond(() => toDetail(actorOf(accountId, 'read'), owned(actorOf(accountId, 'read'), id), now))
}

export function getMetrics(accountId: string, query: { from?: string; to?: string } = {}, now: Date = new Date()) {
  return respond((): AuthorizationSlaMetrics => {
    const actor = actorOf(accountId, 'read')
    const mine = db.insurerOps.authorizations.filter((a) => a.insurerId === actor.insurerId)
    const to = query.to ?? new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)
    const from = query.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    if (!(span > 0) || span > 366) throw new AppError('VALIDATION_ERROR')
    const open = mine.filter((a) => a.status === 'IN_REVIEW' || a.status === 'INFO_REQUESTED')
    const decided = mine.filter((a) => (a.status === 'APPROVED' || a.status === 'REJECTED') && (a.originalDecisionAt ?? a.updatedAt) >= `${from}T00:00:00.000Z` && (a.originalDecisionAt ?? a.updatedAt) < `${to}T00:00:00.000Z`)
    const within = decided.filter((a) => (a.originalDecisionAt ?? a.updatedAt) <= (a.decisionDueAt ?? '')).length
    const auto = decided.filter((a) => metaOf(a).decidedBy === 'SYSTEM').length
    const pct = (n: number) => (decided.length === 0 ? null : Math.round((n / decided.length) * 1000) / 10)
    const hours = decided.map((a) => (new Date(a.originalDecisionAt ?? a.updatedAt).getTime() - new Date(a.createdAt).getTime()) / 3_600_000).sort((x, y) => x - y)
    const mid = hours.length === 0 ? null : hours.length % 2 ? (hours[(hours.length - 1) / 2] ?? null) : (((hours[hours.length / 2 - 1] ?? 0) + (hours[hours.length / 2] ?? 0)) / 2)
    return {
      open: {
        total: open.length,
        unassigned: open.filter((a) => a.status === 'IN_REVIEW' && !metaOf(a).assignedToId && !a.parentRequestId).length,
        overdue: open.filter((a) => a.status === 'IN_REVIEW' && slaOf(a, metaOf(a), now) === 'OVERDUE').length,
        escalated: open.filter((a) => a.status === 'IN_REVIEW' && metaOf(a).escalatedAt).length,
        infoRequested: open.filter((a) => a.status === 'INFO_REQUESTED').length,
      },
      period: {
        from,
        to,
        decided: decided.length,
        approved: decided.filter((a) => a.status === 'APPROVED').length,
        rejected: decided.filter((a) => a.status === 'REJECTED').length,
        autoApproved: auto,
        decidedWithinSla: within,
        slaMetPct: pct(within),
        autoApprovedPct: pct(auto),
        medianDecisionHours: mid === null ? null : Math.round(mid * 100) / 100,
      },
    }
  })
}

export function listAssignees(accountId: string) {
  return respond((): AuthorizationAssignee[] => {
    const actor = actorOf(accountId, 'assignees')
    return db.insuranceAccounts.filter((a) => a.insurerId === actor.insurerId && a.role === 'AUTHORIZATION_ANALYST' && a.status === 'ACTIVE').map((a) => ({ id: a.id, email: a.email }))
  })
}

// --- Decisão ---

const reason = (text: unknown, max = 500) => {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value || value.length > max) throw new AppError('VALIDATION_ERROR')
  return value
}

function claim(actor: Actor, a: Stored, now: Date) {
  const meta = metaOf(a)
  if (actor.role === 'AUTHORIZATION_ANALYST' && !meta.assignedToId) meta.assignedToId = actor.accountId
  void now
}

export function assign(accountId: string, id: string, analystId?: string | null, now: Date = new Date()) {
  return respond(() => {
    const actor = actorOf(accountId, 'decide')
    const a = owned(actor, id)
    const meta = metaOf(a)
    let target: string | null
    if (actor.role === 'SUPERVISOR') {
      if (analystId === undefined) throw new AppError('VALIDATION_ERROR')
      target = analystId
    } else {
      if (analystId !== undefined && analystId !== accountId) throw new AppError('FORBIDDEN')
      target = accountId
    }
    allow(target === null ? 'UNASSIGN' : 'ASSIGN', actor, a, now)
    if (target !== null && actor.role === 'SUPERVISOR' && !db.insuranceAccounts.some((x) => x.id === target && x.insurerId === actor.insurerId && x.role === 'AUTHORIZATION_ANALYST' && x.status === 'ACTIVE')) throw new AppError('VALIDATION_ERROR')
    if (target !== null && target === meta.priorRejecterId) throw new AppError('VALIDATION_ERROR')
    meta.assignedToId = target
    return toDetail(actor, a, now)
  })
}

export function approve(accountId: string, id: string, input: ApproveInput = {}, now: Date = new Date()) {
  return respond(() => {
    const actor = actorOf(accountId, 'decide')
    const a = owned(actor, id)
    allow('APPROVE', actor, a, now)
    const coverage = coverageOf(a)
    if (coverage.reason !== 'COVERED' && coverage.reason !== 'WAITING_PERIOD' && coverage.reason !== 'LIMIT_EXHAUSTED') throw new AppError('VALIDATION_ERROR')
    const amount = input.authorizedAmount ?? a.requestedAmount
    if (!(amount > 0) || amount > a.requestedAmount || (coverage.remaining != null && amount > coverage.remaining)) throw new AppError('VALIDATION_ERROR')
    const partial = amount < a.requestedAmount
    if (partial && !input.note?.trim()) throw new AppError('VALIDATION_ERROR')
    if ((coverage.reason === 'WAITING_PERIOD' || coverage.reason === 'LIMIT_EXHAUSTED') && !input.overrideReason?.trim()) throw new AppError('VALIDATION_ERROR')
    const validUntil = input.validUntil ?? endOfDay(a.expectedOn, VALIDITY_DAYS)
    if (input.validUntil && (new Date(input.validUntil).getTime() <= now.getTime() || new Date(input.validUntil).getTime() > new Date(endOfDay(a.expectedOn, 365)).getTime())) throw new AppError('VALIDATION_ERROR')
    const meta = metaOf(a)
    claim(actor, a, now)
    const decidedBy: AuthorizationDecider = actor.role === 'SUPERVISOR' ? 'SUPERVISOR' : 'ANALYST'
    a.status = 'APPROVED'
    a.authorizedAmount = amount
    a.code = code()
    a.validUntil = validUntil
    a.decisionNote = input.note?.trim() || null
    a.infoExpiresAt = null
    a.originalDecisionAt = now.toISOString()
    meta.decidedBy = decidedBy
    meta.decidedByAccountId = accountId
    log(a, { status: 'APPROVED', occurredAt: now.toISOString(), by: decidedBy, note: a.decisionNote, internalNote: input.overrideReason?.trim() || null }, 'INSURER', now)
    return toDetail(actor, a, now)
  })
}

export function reject(accountId: string, id: string, text: string, now: Date = new Date()) {
  return respond(() => {
    const actor = actorOf(accountId, 'decide')
    const a = owned(actor, id)
    allow('REJECT', actor, a, now)
    const note = reason(text)
    const meta = metaOf(a)
    claim(actor, a, now)
    const decidedBy: AuthorizationDecider = actor.role === 'SUPERVISOR' ? 'SUPERVISOR' : 'ANALYST'
    a.status = 'REJECTED'
    a.decisionNote = note
    a.originalDecisionAt = now.toISOString()
    meta.decidedBy = decidedBy
    meta.decidedByAccountId = accountId
    log(a, { status: 'REJECTED', occurredAt: now.toISOString(), by: decidedBy, note, internalNote: null }, 'INSURER', now)
    return toDetail(actor, a, now)
  })
}

export function requestInfo(accountId: string, id: string, text: string, now: Date = new Date()) {
  return respond(() => {
    const actor = actorOf(accountId, 'decide')
    const a = owned(actor, id)
    allow('REQUEST_INFO', actor, a, now)
    const note = reason(text)
    claim(actor, a, now)
    a.status = 'INFO_REQUESTED'
    a.decisionNote = note
    a.infoExpiresAt = addHours(now, INFO_EXPIRY_DAYS * 24)
    log(a, { status: 'INFO_REQUESTED', occurredAt: now.toISOString(), by: actor.role === 'SUPERVISOR' ? 'SUPERVISOR' : 'ANALYST', note, internalNote: null }, 'INSURER', now)
    return toDetail(actor, a, now)
  })
}

export function cancel(accountId: string, id: string, text: string, now: Date = new Date()) {
  return respond(() => {
    const actor = actorOf(accountId, 'decide')
    const a = owned(actor, id)
    allow('CANCEL', actor, a, now)
    const note = reason(text)
    a.status = 'CANCELLED'
    a.closedReason = 'ANALYST_CANCELLED'
    a.decisionNote = note
    log(a, { status: 'CANCELLED', occurredAt: now.toISOString(), by: actor.role === 'SUPERVISOR' ? 'SUPERVISOR' : 'ANALYST', note, internalNote: null }, 'INSURER', now)
    return toDetail(actor, a, now)
  })
}

export function reopen(accountId: string, id: string, text: string, now: Date = new Date()) {
  return respond(() => {
    const actor = actorOf(accountId, 'decide')
    const a = owned(actor, id)
    allow('REOPEN', actor, a, now)
    const note = reason(text)
    const meta = metaOf(a)
    meta.priorRejecterId = meta.decidedByAccountId
    meta.decidedBy = null
    meta.decidedByAccountId = null
    meta.assignedToId = null
    meta.escalatedAt = null
    a.status = 'IN_REVIEW'
    a.decisionNote = null
    a.decisionDueAt = addHours(now, a.parentRequestId ? APPEAL_RESPONSE_HOURS : DECISION_HOURS)
    a.originalDecisionAt = undefined
    // O motivo é INTERNO: a clínica vê só que voltou à análise.
    log(a, { status: 'IN_REVIEW', occurredAt: now.toISOString(), by: 'SUPERVISOR', note: null, internalNote: note }, 'INSURER', now)
    return toDetail(actor, a, now)
  })
}

export function downloadAttachment(accountId: string, id: string, attachmentId: string, now: Date = new Date()) {
  return respondBlob(() => {
    const actor = actorOf(accountId, 'decide')
    const a = owned(actor, id)
    allow('DOWNLOAD_ATTACHMENT', actor, a, now)
    const attachment = a.attachments?.find((x) => x.id === attachmentId)
    if (!attachment) throw new AppError('NOT_FOUND')
    return new Blob([`Anexo de demonstração: ${attachment.originalName}`], { type: attachment.mimeType })
  })
}

/** Job `insurer.flag-sla-breaches` (só marca; nunca decide). Só para testes e para o ecrã demo. */
export function flagSlaBreaches(now: Date = new Date()): number {
  let flagged = 0
  for (const a of db.insurerOps.authorizations) {
    const meta = metaOf(a)
    if (a.status === 'IN_REVIEW' && !meta.escalatedAt && new Date(a.decisionDueAt ?? a.createdAt).getTime() <= now.getTime()) {
      meta.escalatedAt = now.toISOString()
      flagged += 1
    }
  }
  return flagged
}

// --- Regras de aprovação automática ---

function ruleView(rule: (typeof db.insurerOps.autoApprovalRules)[number]): AutoApprovalRule {
  const { insurerId: _i, ...rest } = rule
  return rest
}

function targetName(rule: { serviceKindId?: string | null; serviceId?: string | null }, insurerId: string) {
  if (rule.serviceId) return db.insurerOps.services.find((s) => s.id === rule.serviceId && s.insurerId === insurerId)?.name ?? ''
  return db.insurerOps.serviceKinds.find((k) => k.id === rule.serviceKindId && k.insurerId === insurerId)?.name ?? ''
}

export function listServiceKinds(accountId: string) {
  return respond((): InsurerServiceKind[] => {
    const actor = actorOf(accountId, 'rules-read')
    return db.insurerOps.serviceKinds.filter((k) => k.insurerId === actor.insurerId && k.status === 'ACTIVE').map(({ insurerId: _i, ...rest }) => rest)
  })
}

export function listRules(accountId: string) {
  return respond((): AutoApprovalRule[] => {
    const actor = actorOf(accountId, 'rules-read')
    return db.insurerOps.autoApprovalRules
      .filter((r) => r.insurerId === actor.insurerId)
      .sort((x, y) => Number(y.active) - Number(x.active) || x.name.localeCompare(y.name, 'pt-PT'))
      .map(ruleView)
  })
}

function targetTaken(insurerId: string, rule: { serviceKindId?: string | null; serviceId?: string | null }, exceptId?: string) {
  return db.insurerOps.autoApprovalRules.some(
    (r) => r.insurerId === insurerId && r.active && r.id !== exceptId && (rule.serviceId ? r.serviceId === rule.serviceId : r.serviceKindId === rule.serviceKindId),
  )
}

export function createRule(accountId: string, input: AutoApprovalRuleInput, now: Date = new Date()) {
  return respond((): AutoApprovalRule => {
    const actor = actorOf(accountId, 'rules-write')
    const name = input.name?.trim()
    if (!name || name.length > 80 || !(input.maxAmount > 0) || Boolean(input.serviceKindId) === Boolean(input.serviceId)) throw new AppError('VALIDATION_ERROR')
    if (input.serviceId && !db.insurerOps.services.some((s) => s.id === input.serviceId && s.insurerId === actor.insurerId && s.status === 'ACTIVE')) throw new AppError('VALIDATION_ERROR')
    if (input.serviceKindId && !db.insurerOps.serviceKinds.some((k) => k.id === input.serviceKindId && k.insurerId === actor.insurerId && k.status === 'ACTIVE')) throw new AppError('VALIDATION_ERROR')
    if (db.insurerOps.autoApprovalRules.filter((r) => r.insurerId === actor.insurerId).length >= MAX_RULES) throw new AppError('LIMIT_EXCEEDED')
    const active = input.active ?? true
    if (active && targetTaken(actor.insurerId, input)) throw new AppError('CONFLICT')
    const rule = {
      id: newId('rul'),
      insurerId: actor.insurerId,
      name,
      scope: input.serviceId ? ('SERVICE' as const) : ('SERVICE_KIND' as const),
      serviceKindId: input.serviceKindId ?? null,
      serviceId: input.serviceId ?? null,
      targetName: targetName(input, actor.insurerId),
      maxAmount: input.maxAmount,
      currency: db.insurerOps.modules[actor.insurerId]?.currency ?? 'AOA',
      active,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    db.insurerOps.autoApprovalRules.push(rule)
    return ruleView(rule)
  })
}

export function updateRule(accountId: string, id: string, patch: AutoApprovalRulePatch, now: Date = new Date()) {
  return respond((): AutoApprovalRule => {
    const actor = actorOf(accountId, 'rules-write')
    const rule = db.insurerOps.autoApprovalRules.find((r) => r.id === id && r.insurerId === actor.insurerId)
    if (!rule) throw new AppError('NOT_FOUND')
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR')
    if (patch.name !== undefined) {
      if (!patch.name.trim() || patch.name.trim().length > 80) throw new AppError('VALIDATION_ERROR')
      rule.name = patch.name.trim()
    }
    if (patch.maxAmount !== undefined) {
      if (!(patch.maxAmount > 0)) throw new AppError('VALIDATION_ERROR')
      rule.maxAmount = patch.maxAmount
    }
    if (patch.active !== undefined) {
      if (patch.active && !rule.active && targetTaken(actor.insurerId, rule, rule.id)) throw new AppError('CONFLICT')
      rule.active = patch.active
    }
    rule.updatedAt = now.toISOString()
    return ruleView(rule)
  })
}

export function deleteRule(accountId: string, id: string) {
  return respond((): void => {
    const actor = actorOf(accountId, 'rules-write')
    // Idempotente: 204 mesmo que já não exista.
    db.insurerOps.autoApprovalRules = db.insurerOps.autoApprovalRules.filter((r) => !(r.id === id && r.insurerId === actor.insurerId))
  })
}

/**
 * Chamado pela criação do pedido da clínica (`clinicAuthorizations`): auto-aprovação UMA vez, só em pedidos que não são recurso (BR-AUT-03).
 * A regra do serviço precede a do tipo; amarelo por carência ou limite nunca se auto-aprova; o rasto fica só para a seguradora.
 */
export function evaluateAutoApproval(a: Stored, now: Date): void {
  if (a.parentRequestId) return
  const rules = db.insurerOps.autoApprovalRules.filter((r) => r.insurerId === a.insurerId && r.active)
  const service = db.insurerOps.services.find((s) => s.insurerId === a.insurerId && s.code === a.serviceCode)
  const rule = rules.find((r) => r.serviceId === service?.id)
  const coverage = coverageOf(a)
  const checks: AutoApprovalTrace['checks'] = [
    { check: 'NOT_APPEAL', ok: true, reason: 'OK' },
    { check: 'COVERED_REQUIRES_AUTHORIZATION', ok: coverage.reason === 'COVERED' && coverage.requiresAuthorization, reason: coverage.reason !== 'COVERED' ? coverage.reason : coverage.requiresAuthorization ? 'OK' : 'AUTHORIZATION_NOT_REQUIRED' },
    { check: 'WITHIN_LIMIT', ok: coverage.remaining == null || a.requestedAmount <= coverage.remaining, reason: coverage.remaining == null || a.requestedAmount <= coverage.remaining ? 'OK' : 'AMOUNT_ABOVE_LIMIT' },
    rule ? { check: 'RULE_MATCH', ok: a.requestedAmount <= rule.maxAmount, reason: a.requestedAmount <= rule.maxAmount ? 'OK' : 'AMOUNT_ABOVE_RULE_MAX' } : { check: 'RULE_MATCH', ok: false, reason: 'NO_RULE_FOR_SERVICE' },
  ]
  const ok = checks.every((c) => c.ok)
  // A auto-aprovação é `SUBMITTED → APPROVED`: não passa por «em análise».
  if (ok) a.timeline = (a.timeline ?? []).filter((e) => e.status !== 'IN_REVIEW')
  const meta = metaOf(a)
  meta.autoApproval = { ok, ruleId: rule?.id ?? null, ruleName: rule?.name ?? null, checks }
  if (!ok) return
  a.status = 'APPROVED'
  a.authorizedAmount = a.requestedAmount
  a.code = code()
  a.validUntil = endOfDay(a.expectedOn, VALIDITY_DAYS)
  a.originalDecisionAt = now.toISOString()
  meta.decidedBy = 'SYSTEM'
  log(a, { status: 'APPROVED', occurredAt: now.toISOString(), by: 'SYSTEM', note: null, internalNote: null }, 'INSURER', now)
}

export type { AuthorizationRequest }
