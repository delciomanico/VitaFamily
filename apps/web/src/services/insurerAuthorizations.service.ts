import * as mock from '@/mocks/handlers/insurerAuthorizations'
import { AppError } from '@/lib/errors'
import { hasApiBackend } from '@/lib/apiClient'
import { insuranceApiBlob, insuranceApiFetch } from '@/lib/insuranceApiClient'
import { asArray } from '@/lib/safe'
import { insuranceSessionStore } from '@/lib/storage'
import type { Page } from '@/types/insurerOps'
import type {
  ApproveInput,
  AuthorizationAssignee,
  AuthorizationSlaMetrics,
  AutoApprovalRule,
  AutoApprovalRuleInput,
  AutoApprovalRulePatch,
  InsurerAuthorization,
  InsurerAuthorizationDetail,
  InsurerAuthorizationQuery,
  InsurerServiceKind,
} from '@/types/insurerAuthorizations'

/**
 * Decisão pela seguradora (marco B fatia 4, ADR-035) no portal `/insurance-portal/*`: fila, detalhe, aprovar/recusar/pedir informação,
 * atribuir, reverter, reabrir, descarregar anexos, métricas de prazo e regras de aprovação automática. O servidor devolve `allowedActions`
 * calculadas para o papel e o pedido: a UI mostra só esses botões. Nunca ids de família/membro nem dados clínicos (C2).
 */
const LIMIT = 25

const qs = (query: Record<string, string | number | boolean | undefined>): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value))
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** Defesa contra respostas fora do contrato: `items` ausente ⇒ lista vazia; `nextCursor` ausente ⇒ fim. */
function safePage<T>(raw: Page<T> | null | undefined): Page<T> {
  return { items: asArray(raw?.items), nextCursor: raw?.nextCursor ?? null }
}

const api = <T>(path: string, options?: { method?: string; body?: unknown }) => insuranceApiFetch<T>(path, options)

function accountId(): string {
  const id = insuranceSessionStore.getAccountId()
  if (!id) throw new AppError('INVALID_CREDENTIALS')
  return id
}

interface Service {
  list(query?: InsurerAuthorizationQuery): Promise<Page<InsurerAuthorization>>
  get(id: string): Promise<InsurerAuthorizationDetail>
  metrics(range?: { from?: string; to?: string }): Promise<AuthorizationSlaMetrics>
  assignees(): Promise<AuthorizationAssignee[]>
  /** `analystId` omitido = eu (analista); `null` liberta (supervisor). */
  assign(id: string, analystId?: string | null): Promise<InsurerAuthorizationDetail>
  approve(id: string, input?: ApproveInput): Promise<InsurerAuthorizationDetail>
  reject(id: string, reason: string): Promise<InsurerAuthorizationDetail>
  requestInfo(id: string, reason: string): Promise<InsurerAuthorizationDetail>
  /** Reverter uma aprovação (o motivo é visível à clínica). */
  cancel(id: string, reason: string): Promise<InsurerAuthorizationDetail>
  /** Reabrir uma recusa (só supervisor; o motivo é interno). */
  reopen(id: string, reason: string): Promise<InsurerAuthorizationDetail>
  downloadAttachment(id: string, attachmentId: string): Promise<Blob>
  listRules(): Promise<AutoApprovalRule[]>
  createRule(input: AutoApprovalRuleInput): Promise<AutoApprovalRule>
  updateRule(id: string, patch: AutoApprovalRulePatch): Promise<AutoApprovalRule>
  deleteRule(id: string): Promise<void>
  listServiceKinds(): Promise<InsurerServiceKind[]>
}

const text = (value: string) => value.trim()

const apiImpl: Service = {
  list: async (query = {}) => {
    const { cursor, ...filters } = query
    return safePage(await api<Page<InsurerAuthorization>>(`/authorizations${qs({ limit: LIMIT, ...filters, cursor })}`))
  },
  get: (id) => api(`/authorizations/${id}`),
  metrics: (range = {}) => api(`/authorizations/metrics${qs(range)}`),
  assignees: async () => asArray(await api<AuthorizationAssignee[]>('/authorizations/assignees')),
  assign: (id, analystId) => api(`/authorizations/${id}/assign`, { method: 'POST', body: analystId === undefined ? {} : { analystId } }),
  approve: (id, input = {}) => api(`/authorizations/${id}/approve`, { method: 'POST', body: input }),
  reject: (id, reason) => api(`/authorizations/${id}/reject`, { method: 'POST', body: { reason: text(reason) } }),
  requestInfo: (id, reason) => api(`/authorizations/${id}/request-info`, { method: 'POST', body: { reason: text(reason) } }),
  cancel: (id, reason) => api(`/authorizations/${id}/cancel`, { method: 'POST', body: { reason: text(reason) } }),
  reopen: (id, reason) => api(`/authorizations/${id}/reopen`, { method: 'POST', body: { reason: text(reason) } }),
  downloadAttachment: (id, attachmentId) => insuranceApiBlob(`/authorizations/${id}/attachments/${attachmentId}`),
  listRules: async () => asArray(await api<AutoApprovalRule[]>('/auto-approval-rules')),
  createRule: (input) => api('/auto-approval-rules', { method: 'POST', body: input }),
  updateRule: (id, patch) => api(`/auto-approval-rules/${id}`, { method: 'PATCH', body: patch }),
  deleteRule: (id) => api(`/auto-approval-rules/${id}`, { method: 'DELETE' }),
  listServiceKinds: async () => asArray(await api<InsurerServiceKind[]>('/service-kinds?status=ACTIVE')),
}

const mockImpl: Service = {
  list: (query) => mock.listAuthorizations(accountId(), query),
  get: (id) => mock.getAuthorization(accountId(), id),
  metrics: (range) => mock.getMetrics(accountId(), range),
  assignees: () => mock.listAssignees(accountId()),
  assign: (id, analystId) => mock.assign(accountId(), id, analystId),
  approve: (id, input) => mock.approve(accountId(), id, input),
  reject: (id, reason) => mock.reject(accountId(), id, reason),
  requestInfo: (id, reason) => mock.requestInfo(accountId(), id, reason),
  cancel: (id, reason) => mock.cancel(accountId(), id, reason),
  reopen: (id, reason) => mock.reopen(accountId(), id, reason),
  downloadAttachment: (id, attachmentId) => mock.downloadAttachment(accountId(), id, attachmentId),
  listRules: () => mock.listRules(accountId()),
  createRule: (input) => mock.createRule(accountId(), input),
  updateRule: (id, patch) => mock.updateRule(accountId(), id, patch),
  deleteRule: (id) => mock.deleteRule(accountId(), id),
  listServiceKinds: () => mock.listServiceKinds(accountId()),
}

export const insurerAuthorizationsService: Service = hasApiBackend() ? apiImpl : mockImpl
