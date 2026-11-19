import * as mock from '@/mocks/handlers/messaging'
import { hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined, professionalApiFetch } from '@/lib/professionalApiClient'
import type { ChatMessage, MessageReportReceipt, Page, ProfessionalConversation, ReportMessageInput } from '@/types/marketplace'

/**
 * Conversas do profissional (`/professional-portal/conversations*`, MK2). Sessão própria da conta de
 * profissional (nunca a de `User`); a vista da família é só o `participantLabel` (BR-MKT-38). Em
 * `SUSPENDED`/`REJECTED` a leitura continua e enviar/fechar/reabrir dá `PROFESSIONAL_LOCKED` (BR-MKT-47).
 */
const call = <T>(path: string, options?: { method?: string; body?: unknown }) => professionalApiFetch<unknown>(`/conversations${path}`, options).then((data) => nullsToUndefined<T>(data))
const pageOf = <T>(page: Page<T>): Page<T> => ({ items: page.items, nextCursor: page.nextCursor ?? null })
const id = encodeURIComponent

const mockImpl = {
  list: (status?: 'OPEN' | 'CLOSED'): Promise<Page<ProfessionalConversation>> => mock.listProfessionalConversations({ status }),
  get: (conversationId: string): Promise<ProfessionalConversation> => mock.getProfessionalConversation(conversationId),
  messages: (conversationId: string, cursor?: string): Promise<Page<ChatMessage>> => mock.listProfessionalMessages(conversationId, { cursor }),
  send: (conversationId: string, input: { text: string; clientMessageId?: string }): Promise<ChatMessage> => mock.sendProfessionalMessage(conversationId, input),
  markRead: (conversationId: string, upToSeq?: number): Promise<ProfessionalConversation> => mock.markProfessionalConversationRead(conversationId, upToSeq),
  close: (conversationId: string): Promise<ProfessionalConversation> => mock.closeProfessionalConversation(conversationId),
  reopen: (conversationId: string): Promise<ProfessionalConversation> => mock.reopenProfessionalConversation(conversationId),
  report: (conversationId: string, messageId: string, input: ReportMessageInput): Promise<MessageReportReceipt> => mock.reportProfessionalMessage(conversationId, messageId, input),
}

const apiImpl: typeof mockImpl = {
  list: (status) => call<Page<ProfessionalConversation>>(status ? `?status=${status}` : '').then(pageOf),
  get: (conversationId) => call<ProfessionalConversation>(`/${id(conversationId)}`),
  messages: (conversationId, cursor) => call<Page<ChatMessage>>(`/${id(conversationId)}/messages${cursor ? `?cursor=${id(cursor)}` : ''}`).then(pageOf),
  send: (conversationId, input) => call<ChatMessage>(`/${id(conversationId)}/messages`, { method: 'POST', body: input }),
  markRead: (conversationId, upToSeq) => call<ProfessionalConversation>(`/${id(conversationId)}/read`, { method: 'PUT', body: upToSeq === undefined ? {} : { upToSeq } }),
  close: (conversationId) => call<ProfessionalConversation>(`/${id(conversationId)}/close`, { method: 'POST' }),
  reopen: (conversationId) => call<ProfessionalConversation>(`/${id(conversationId)}/reopen`, { method: 'POST' }),
  report: (conversationId, messageId, input) => call<MessageReportReceipt>(`/${id(conversationId)}/messages/${id(messageId)}/reports`, { method: 'POST', body: input }),
}

export const professionalConversationService = hasApiBackend() ? apiImpl : mockImpl
