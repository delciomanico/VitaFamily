import * as mock from '@/mocks/handlers/messaging'
import { listManagedMembers } from '@/mocks/handlers/family'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined } from '@/lib/professionalApiClient'
import type {
  ChatMessage,
  ConversationStarted,
  FamilyConversation,
  MessageReportReceipt,
  Page,
  ReportMessageInput,
  StartConversationInput,
} from '@/types/marketplace'

/**
 * Conversas da família com profissionais (`/families/{f}/members/{m}/conversations*`, MK2). Só o titular
 * (`SELF`) e o tutor em nome do dependente conversam; dependente com conta não (BR-MKT-38). Os dois tutores
 * veem a mesma conversa. O texto das mensagens é dado de saúde potencial: nunca vai para logs (BR-MKT-46).
 */
export interface MessagingMember {
  id: string
  name: string
  isSelf: boolean
}

export type FamilyConversationRow = FamilyConversation & { memberName: string }

/** `Member` (openapi.yaml) reduzido ao que decide quem pode conversar. */
interface ApiMember {
  id: string
  name: string
  isSelf: boolean
  isDependent: boolean
  hasAccount: boolean
  status: 'ACTIVE' | 'BLOCKED'
  guardianIds?: string[]
}

const base = (familyId: string, memberId: string) => `/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(memberId)}/conversations`
const call = <T>(path: string, options?: { method?: string; body?: unknown }) => apiFetch<unknown>(path, options).then((data) => nullsToUndefined<T>(data))
const pageOf = <T>(page: Page<T>): Page<T> => ({ items: page.items, nextCursor: page.nextCursor ?? null })

const mockImpl = {
  async eligibleMembers(familyId: string, userId: string): Promise<MessagingMember[]> {
    const managed = await listManagedMembers(familyId, userId)
    return managed
      .filter((m) => m.status === 'ACTIVE' && !(m.isDependent && m.userId))
      .map((m) => ({ id: m.id, name: m.name, isSelf: m.userId === userId }))
  },
  list: (familyId: string, userId: string, memberId: string, status?: 'OPEN' | 'CLOSED') => mock.listFamilyConversations(familyId, userId, memberId, { status }),
  get: (familyId: string, userId: string, memberId: string, conversationId: string) => mock.getFamilyConversation(familyId, userId, memberId, conversationId),
  start: (familyId: string, userId: string, memberId: string, input: StartConversationInput): Promise<ConversationStarted> => mock.startFamilyConversation(familyId, userId, memberId, input),
  messages: (familyId: string, userId: string, memberId: string, conversationId: string, cursor?: string, limit?: number): Promise<Page<ChatMessage>> =>
    mock.listFamilyMessages(familyId, userId, memberId, conversationId, { cursor, limit }),
  send: (familyId: string, userId: string, memberId: string, conversationId: string, input: { text: string; clientMessageId?: string }): Promise<ChatMessage> =>
    mock.sendFamilyMessage(familyId, userId, memberId, conversationId, input),
  markRead: (familyId: string, userId: string, memberId: string, conversationId: string, upToSeq?: number) =>
    mock.markFamilyConversationRead(familyId, userId, memberId, conversationId, upToSeq),
  close: (familyId: string, userId: string, memberId: string, conversationId: string) => mock.closeFamilyConversation(familyId, userId, memberId, conversationId),
  reopen: (familyId: string, userId: string, memberId: string, conversationId: string) => mock.reopenFamilyConversation(familyId, userId, memberId, conversationId),
  report: (familyId: string, userId: string, memberId: string, conversationId: string, messageId: string, input: ReportMessageInput): Promise<MessageReportReceipt> =>
    mock.reportFamilyMessage(familyId, userId, memberId, conversationId, messageId, input),
}

const apiImpl: typeof mockImpl = {
  async eligibleMembers(familyId) {
    const members = await call<ApiMember[]>(`/families/${encodeURIComponent(familyId)}/members`)
    const selfId = members.find((m) => m.isSelf)?.id
    return members
      .filter((m) => m.status === 'ACTIVE' && (m.isSelf || (m.isDependent && !m.hasAccount && selfId !== undefined && m.guardianIds?.includes(selfId))))
      .map((m) => ({ id: m.id, name: m.name, isSelf: m.isSelf }))
  },
  list: (familyId, _userId, memberId, status) => call<Page<FamilyConversation>>(`${base(familyId, memberId)}${status ? `?status=${status}` : ''}`).then(pageOf),
  get: (familyId, _userId, memberId, id) => call<FamilyConversation>(`${base(familyId, memberId)}/${encodeURIComponent(id)}`),
  async start(familyId, _userId, memberId, input) {
    // `POST` devolve 201 (criada) ou 200 (mensagem acrescentada); a distinção não é usada pela UI.
    const started = await call<Omit<ConversationStarted, 'created'>>(base(familyId, memberId), { method: 'POST', body: input })
    return { ...started, created: true }
  },
  messages: (familyId, _userId, memberId, id, cursor, limit) => {
    const query = new URLSearchParams()
    if (cursor) query.set('cursor', cursor)
    if (limit) query.set('limit', String(limit))
    const text = query.toString()
    return call<Page<ChatMessage>>(`${base(familyId, memberId)}/${encodeURIComponent(id)}/messages${text ? `?${text}` : ''}`).then(pageOf)
  },
  send: (familyId, _userId, memberId, id, input) => call<ChatMessage>(`${base(familyId, memberId)}/${encodeURIComponent(id)}/messages`, { method: 'POST', body: input }),
  markRead: (familyId, _userId, memberId, id, upToSeq) =>
    call<FamilyConversation>(`${base(familyId, memberId)}/${encodeURIComponent(id)}/read`, { method: 'PUT', body: upToSeq === undefined ? {} : { upToSeq } }),
  close: (familyId, _userId, memberId, id) => call<FamilyConversation>(`${base(familyId, memberId)}/${encodeURIComponent(id)}/close`, { method: 'POST' }),
  reopen: (familyId, _userId, memberId, id) => call<FamilyConversation>(`${base(familyId, memberId)}/${encodeURIComponent(id)}/reopen`, { method: 'POST' }),
  report: (familyId, _userId, memberId, id, messageId, input) =>
    call<MessageReportReceipt>(`${base(familyId, memberId)}/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/reports`, { method: 'POST', body: input }),
}

const impl = hasApiBackend() ? apiImpl : mockImpl

export const conversationService = {
  ...impl,
  /** Última mensagem da conversa (a listagem vem das mais recentes para as mais antigas; pede só uma). */
  async lastMessage(familyId: string, userId: string, memberId: string, conversationId: string): Promise<ChatMessage | null> {
    const page = await impl.messages(familyId, userId, memberId, conversationId, undefined, 1)
    return page.items[0] ?? null
  },
  /** Todas as conversas dos membros em que o utilizador pode conversar, a mais recente primeiro. */
  async listAll(familyId: string, userId: string, status?: 'OPEN' | 'CLOSED'): Promise<FamilyConversationRow[]> {
    const members = await impl.eligibleMembers(familyId, userId)
    const lists = await Promise.all(
      members.map((member) => impl.list(familyId, userId, member.id, status).then((page) => page.items.map((item) => ({ ...item, memberName: member.name })))),
    )
    return lists.flat().sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
  },
}
