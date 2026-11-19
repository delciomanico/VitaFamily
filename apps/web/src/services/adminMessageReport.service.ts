import * as mock from '@/mocks/handlers/messageReports'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined } from '@/lib/professionalApiClient'
import type { AdminMessageReportDetail, AdminMessageReportItem, MessageReportDecision, Page } from '@/types/marketplace'

/**
 * Moderação de denúncias de mensagens (`/admin/message-reports*`, MK2, BR-MKT-44). Mesma sessão de `User`
 * com `platformRole`. O detalhe mostra só a mensagem denunciada e até 2 anteriores; a leitura é auditada.
 */
const call = <T>(path: string, options?: { method?: string; body?: unknown }) => apiFetch<unknown>(`/admin/message-reports${path}`, options).then((data) => nullsToUndefined<T>(data))

const mockImpl = {
  list: (status?: 'OPEN' | 'DECIDED', cursor?: string): Promise<Page<AdminMessageReportItem>> => mock.adminListMessageReports({ status, cursor }),
  get: (reportId: string): Promise<AdminMessageReportDetail> => mock.adminGetMessageReport(reportId),
  decide: (reportId: string, decision: MessageReportDecision): Promise<AdminMessageReportDetail> => mock.adminDecideMessageReport(reportId, decision),
}

const apiImpl: typeof mockImpl = {
  list(status, cursor) {
    const search = new URLSearchParams()
    if (status) search.set('status', status)
    if (cursor) search.set('cursor', cursor)
    const text = search.toString()
    return call<Page<AdminMessageReportItem>>(text ? `?${text}` : '').then((page) => ({ items: page.items, nextCursor: page.nextCursor ?? null }))
  },
  get: (reportId) => call<AdminMessageReportDetail>(`/${encodeURIComponent(reportId)}`),
  // O `POST …/decisions` devolve o detalhe atualizado (AdminMessageReportDetail).
  decide: (reportId, decision) => call<AdminMessageReportDetail>(`/${encodeURIComponent(reportId)}/decisions`, { method: 'POST', body: { decision } }),
}

export const adminMessageReportService = hasApiBackend() ? apiImpl : mockImpl
