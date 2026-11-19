import { AppError } from '@/lib/errors'
import { REPORT_REASONS, validMessageText } from '@/lib/marketplace'
import type {
  ChatMessage,
  ChatSide,
  ConversationStarted,
  FamilyConversation,
  MessageReportReceipt,
  Page,
  ProfessionalConversation,
  ReportMessageInput,
  StartConversationInput,
} from '@/types/marketplace'
import { db } from '../db'
import { requireSelf, visibleMemberIds } from '../access'
import { marketplaceDb, mktId, type MockConversation, type MockMessage } from '../marketplaceDb'
import { professionalDb } from '../professionalDb'
import { respond } from '../respond'
import { isApprovedProfessional, publicProfessionalName } from './marketplace'
import { requireProfessional } from './professionalPortal'

/*
 * Conversas (MK2, BR-MKT-38..48): lado da família (`/families/{f}/members/{m}/conversations*`) e lado do
 * profissional (`/professional-portal/conversations*`). O texto das mensagens é dado de saúde potencial:
 * nunca é registado (BR-MKT-46). A vista do profissional não contém ids de família, membro nem utilizador.
 */

const PAGE_SIZE = 25
const MAX_OPEN_PER_MEMBER = 20
const MAX_UNANSWERED_FAMILY = 3
const MAX_LABEL = 40

function pageOf<T>(all: T[], limit: number | undefined, cursor: string | undefined): Page<T> {
  const size = Math.min(Math.max(limit ?? PAGE_SIZE, 1), 100)
  const start = cursor ? Number(cursor) : 0
  if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
  return { items: all.slice(start, start + size), nextCursor: start + size < all.length ? String(start + size) : null }
}

const lastSeq = (c: MockConversation) => c.messages[c.messages.length - 1]?.seq ?? 0

/** Estado derivado do profissional: lido a cada pedido (BR-MKT-47). */
function professionalApproved(professionalId: string): boolean {
  const account = professionalDb.professionals.find((p) => p.id === professionalId)
  return account ? account.validationStatus === 'APPROVED' : isApprovedProfessional(professionalId)
}

function toMessage(c: MockConversation, m: MockMessage, viewer: { side: ChatSide; userId?: string }): ChatMessage {
  // «Lida» é relativo ao autor da mensagem: o marcador do lado oposto ao que a escreveu.
  const otherReadSeq = m.side === 'FAMILY' ? c.professionalReadSeq : c.familyReadSeq
  return {
    id: m.id,
    seq: m.seq,
    side: m.side,
    mine: viewer.side === 'FAMILY' ? m.side === 'FAMILY' && m.authorUserId === viewer.userId : m.side === 'PROFESSIONAL',
    text: m.hidden ? undefined : m.text,
    hidden: m.hidden,
    createdAt: m.createdAt,
    readByOtherSide: m.seq <= otherReadSeq,
  }
}

const unreadFor = (c: MockConversation, side: ChatSide) =>
  c.messages.filter((m) => m.side !== side && m.seq > (side === 'FAMILY' ? c.familyReadSeq : c.professionalReadSeq)).length

function toFamilyConversation(c: MockConversation): FamilyConversation {
  const professional = publicProfessionalName(c.professionalId) ?? { id: c.professionalId, displayName: 'Profissional' }
  return {
    id: c.id,
    memberId: c.memberId,
    professional,
    participantLabel: c.participantLabel,
    status: c.status,
    closedBy: c.closedBy,
    canSend: c.status === 'OPEN' && professionalApproved(c.professionalId),
    lastMessageAt: c.lastMessageAt,
    unreadCount: unreadFor(c, 'FAMILY'),
    createdAt: c.createdAt,
  }
}

function toProfessionalConversation(c: MockConversation): ProfessionalConversation {
  return {
    id: c.id,
    participantLabel: c.participantLabel,
    status: c.status,
    closedBy: c.closedBy,
    canSend: c.status === 'OPEN' && professionalApproved(c.professionalId),
    lastMessageAt: c.lastMessageAt,
    unreadCount: unreadFor(c, 'PROFESSIONAL'),
    createdAt: c.createdAt,
  }
}

// ───── Lado da família ─────

/**
 * Ação `MESSAGE_PROFESSIONALS` (authorization.md §11.2): `SELF` ou `TUTOR_OF`; dependente com conta e
 * restantes ⇒ `FORBIDDEN`; membro/família alheios ⇒ `NOT_FOUND`.
 */
function requireMessaging(familyId: string, userId: string, memberId: string) {
  const self = requireSelf(familyId, userId)
  const member = db.members.find((m) => m.id === memberId && m.familyId === familyId)
  if (!member) throw new AppError('NOT_FOUND')
  if (!visibleMemberIds(familyId, userId).includes(memberId) || (member.isDependent && member.userId)) throw new AppError('FORBIDDEN')
  void self
  return member
}

function familyConversation(familyId: string, userId: string, memberId: string, conversationId: string) {
  const member = requireMessaging(familyId, userId, memberId)
  const conversation = marketplaceDb.conversations.find((c) => c.id === conversationId && c.familyId === familyId && c.memberId === memberId)
  if (!conversation) throw new AppError('NOT_FOUND')
  return { member, conversation }
}

function appendMessage(c: MockConversation, side: ChatSide, text: string, userId: string | undefined, clientMessageId?: string): MockMessage {
  const message: MockMessage = {
    id: mktId('msg'),
    seq: lastSeq(c) + 1,
    side,
    authorUserId: userId,
    text,
    hidden: false,
    createdAt: new Date().toISOString(),
    clientMessageId,
  }
  c.messages.push(message)
  c.lastMessageAt = message.createdAt
  // Quem escreve já leu até à sua própria mensagem.
  if (side === 'FAMILY') c.familyReadSeq = message.seq
  else c.professionalReadSeq = message.seq
  return message
}

function assertFamilyCanSend(c: MockConversation) {
  if (c.status === 'CLOSED' || !professionalApproved(c.professionalId)) throw new AppError('CONVERSATION_CLOSED')
  const tail = [...c.messages].reverse()
  const streak = tail.findIndex((m) => m.side === 'PROFESSIONAL')
  if ((streak === -1 ? tail.length : streak) >= MAX_UNANSWERED_FAMILY) throw new AppError('LIMIT_EXCEEDED')
}

export function listFamilyConversations(
  familyId: string,
  userId: string,
  memberId: string,
  query: { status?: 'OPEN' | 'CLOSED'; limit?: number; cursor?: string } = {},
): Promise<Page<FamilyConversation>> {
  return respond(() => {
    requireMessaging(familyId, userId, memberId)
    const all = marketplaceDb.conversations
      .filter((c) => c.familyId === familyId && c.memberId === memberId && (!query.status || c.status === query.status))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .map(toFamilyConversation)
    return pageOf(all, query.limit, query.cursor)
  })
}

export function getFamilyConversation(familyId: string, userId: string, memberId: string, conversationId: string): Promise<FamilyConversation> {
  return respond(() => toFamilyConversation(familyConversation(familyId, userId, memberId, conversationId).conversation))
}

export function startFamilyConversation(familyId: string, userId: string, memberId: string, input: StartConversationInput): Promise<ConversationStarted> {
  return respond(() => {
    const member = requireMessaging(familyId, userId, memberId)
    const text = validMessageText(input.text)
    const label = input.participantLabel.trim()
    if (!text || label.length < 1 || label.length > MAX_LABEL) throw new AppError('VALIDATION_ERROR')
    if (member.status === 'BLOCKED') throw new AppError('MEMBER_BLOCKED')
    if (!isApprovedProfessional(input.professionalId)) throw new AppError('NOT_FOUND')

    const pair = marketplaceDb.conversations.filter((c) => c.familyId === familyId && c.memberId === memberId && c.professionalId === input.professionalId)
    const open = pair.find((c) => c.status === 'OPEN')
    if (pair.some((c) => c.status === 'CLOSED' && c.closedBy !== 'FAMILY') && !open) throw new AppError('CONVERSATION_CLOSED')

    if (open) {
      const repeated = input.clientMessageId ? open.messages.find((m) => m.clientMessageId === input.clientMessageId) : undefined
      if (repeated) return { conversation: toFamilyConversation(open), message: toMessage(open, repeated, { side: 'FAMILY', userId }), created: false }
      assertFamilyCanSend(open)
      const message = appendMessage(open, 'FAMILY', text, userId, input.clientMessageId)
      return { conversation: toFamilyConversation(open), message: toMessage(open, message, { side: 'FAMILY', userId }), created: false }
    }

    const openCount = marketplaceDb.conversations.filter((c) => c.familyId === familyId && c.memberId === memberId && c.status === 'OPEN').length
    if (openCount >= MAX_OPEN_PER_MEMBER) throw new AppError('LIMIT_EXCEEDED')
    const now = new Date().toISOString()
    const conversation: MockConversation = {
      id: mktId('cnv'),
      familyId,
      memberId,
      professionalId: input.professionalId,
      participantLabel: label,
      status: 'OPEN',
      createdAt: now,
      lastMessageAt: now,
      familyReadSeq: 0,
      professionalReadSeq: 0,
      messages: [],
    }
    marketplaceDb.conversations.push(conversation)
    const message = appendMessage(conversation, 'FAMILY', text, userId, input.clientMessageId)
    return { conversation: toFamilyConversation(conversation), message: toMessage(conversation, message, { side: 'FAMILY', userId }), created: true }
  })
}

/** Mensagens, mais recentes primeiro (seq decrescente). A leitura não marca como lido (BR-MKT-40). */
export function listFamilyMessages(
  familyId: string,
  userId: string,
  memberId: string,
  conversationId: string,
  query: { limit?: number; cursor?: string } = {},
): Promise<Page<ChatMessage>> {
  return respond(() => {
    const { conversation } = familyConversation(familyId, userId, memberId, conversationId)
    const all = [...conversation.messages].sort((a, b) => b.seq - a.seq).map((m) => toMessage(conversation, m, { side: 'FAMILY', userId }))
    return pageOf(all, query.limit, query.cursor)
  })
}

export function sendFamilyMessage(
  familyId: string,
  userId: string,
  memberId: string,
  conversationId: string,
  input: { text: string; clientMessageId?: string },
): Promise<ChatMessage> {
  return respond(() => {
    const { member, conversation } = familyConversation(familyId, userId, memberId, conversationId)
    const text = validMessageText(input.text)
    if (!text) throw new AppError('VALIDATION_ERROR')
    if (member.status === 'BLOCKED') throw new AppError('MEMBER_BLOCKED')
    const repeated = input.clientMessageId ? conversation.messages.find((m) => m.clientMessageId === input.clientMessageId) : undefined
    if (repeated) return toMessage(conversation, repeated, { side: 'FAMILY', userId })
    assertFamilyCanSend(conversation)
    return toMessage(conversation, appendMessage(conversation, 'FAMILY', text, userId, input.clientMessageId), { side: 'FAMILY', userId })
  })
}

function markRead(c: MockConversation, side: ChatSide, upToSeq?: number) {
  const target = upToSeq ?? lastSeq(c)
  if (!Number.isInteger(target) || target < 0 || target > lastSeq(c)) throw new AppError('VALIDATION_ERROR')
  if (side === 'FAMILY') c.familyReadSeq = Math.max(c.familyReadSeq, target)
  else c.professionalReadSeq = Math.max(c.professionalReadSeq, target)
}

export function markFamilyConversationRead(familyId: string, userId: string, memberId: string, conversationId: string, upToSeq?: number): Promise<FamilyConversation> {
  return respond(() => {
    const { conversation } = familyConversation(familyId, userId, memberId, conversationId)
    markRead(conversation, 'FAMILY', upToSeq)
    return toFamilyConversation(conversation)
  })
}

export function closeFamilyConversation(familyId: string, userId: string, memberId: string, conversationId: string): Promise<FamilyConversation> {
  return respond(() => {
    const { conversation } = familyConversation(familyId, userId, memberId, conversationId)
    if (conversation.status === 'CLOSED') throw new AppError('INVALID_STATE_TRANSITION')
    conversation.status = 'CLOSED'
    conversation.closedBy = 'FAMILY'
    return toFamilyConversation(conversation)
  })
}

export function reopenFamilyConversation(familyId: string, userId: string, memberId: string, conversationId: string): Promise<FamilyConversation> {
  return respond(() => {
    const { conversation } = familyConversation(familyId, userId, memberId, conversationId)
    if (conversation.status === 'OPEN') throw new AppError('INVALID_STATE_TRANSITION')
    if (conversation.closedBy !== 'FAMILY') throw new AppError('CONVERSATION_CLOSED')
    conversation.status = 'OPEN'
    conversation.closedBy = undefined
    return toFamilyConversation(conversation)
  })
}

function report(c: MockConversation, messageId: string, side: ChatSide, input: ReportMessageInput): MessageReportReceipt {
  const message = c.messages.find((m) => m.id === messageId)
  if (!message) throw new AppError('NOT_FOUND')
  if (message.side === side) throw new AppError('VALIDATION_ERROR')
  if (!REPORT_REASONS.includes(input.reason)) throw new AppError('VALIDATION_ERROR')
  const note = input.note?.trim()
  if (note !== undefined && (note.length < 1 || note.length > 300)) throw new AppError('VALIDATION_ERROR')
  const existing = marketplaceDb.reports.find((r) => r.messageId === messageId && r.reporterSide === side)
  const record =
    existing ??
    (() => {
      const created = {
        id: mktId('rep'),
        conversationId: c.id,
        messageId,
        reporterSide: side,
        reason: input.reason,
        note: note || undefined,
        status: 'OPEN' as const,
        createdAt: new Date().toISOString(),
      }
      marketplaceDb.reports.push(created)
      return created
    })()
  return { id: record.id, status: record.status, reason: record.reason, createdAt: record.createdAt }
}

export function reportFamilyMessage(familyId: string, userId: string, memberId: string, conversationId: string, messageId: string, input: ReportMessageInput): Promise<MessageReportReceipt> {
  return respond(() => report(familyConversation(familyId, userId, memberId, conversationId).conversation, messageId, 'FAMILY', input))
}

// ───── Lado do profissional ─────

function professionalConversation(conversationId: string) {
  const professional = requireProfessional()
  const conversation = marketplaceDb.conversations.find((c) => c.id === conversationId && c.professionalId === professional.id)
  if (!conversation) throw new AppError('NOT_FOUND')
  return { professional, conversation }
}

/** Leitura em todos os estados; escrever/fechar/reabrir exige `APPROVED` (BR-MKT-47). */
function requireApproved(status: string) {
  if (status !== 'APPROVED') throw new AppError('PROFESSIONAL_LOCKED')
}

export function listProfessionalConversations(query: { status?: 'OPEN' | 'CLOSED'; limit?: number; cursor?: string } = {}): Promise<Page<ProfessionalConversation>> {
  return respond(() => {
    const professional = requireProfessional()
    const all = marketplaceDb.conversations
      .filter((c) => c.professionalId === professional.id && (!query.status || c.status === query.status))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .map(toProfessionalConversation)
    return pageOf(all, query.limit, query.cursor)
  })
}

export function getProfessionalConversation(conversationId: string): Promise<ProfessionalConversation> {
  return respond(() => toProfessionalConversation(professionalConversation(conversationId).conversation))
}

export function listProfessionalMessages(conversationId: string, query: { limit?: number; cursor?: string } = {}): Promise<Page<ChatMessage>> {
  return respond(() => {
    const { conversation } = professionalConversation(conversationId)
    const all = [...conversation.messages].sort((a, b) => b.seq - a.seq).map((m) => toMessage(conversation, m, { side: 'PROFESSIONAL' }))
    return pageOf(all, query.limit, query.cursor)
  })
}

export function sendProfessionalMessage(conversationId: string, input: { text: string; clientMessageId?: string }): Promise<ChatMessage> {
  return respond(() => {
    const { professional, conversation } = professionalConversation(conversationId)
    requireApproved(professional.validationStatus)
    const text = validMessageText(input.text)
    if (!text) throw new AppError('VALIDATION_ERROR')
    const repeated = input.clientMessageId ? conversation.messages.find((m) => m.clientMessageId === input.clientMessageId) : undefined
    if (repeated) return toMessage(conversation, repeated, { side: 'PROFESSIONAL' })
    if (conversation.status === 'CLOSED') throw new AppError('CONVERSATION_CLOSED')
    return toMessage(conversation, appendMessage(conversation, 'PROFESSIONAL', text, undefined, input.clientMessageId), { side: 'PROFESSIONAL' })
  })
}

export function markProfessionalConversationRead(conversationId: string, upToSeq?: number): Promise<ProfessionalConversation> {
  return respond(() => {
    const { conversation } = professionalConversation(conversationId)
    markRead(conversation, 'PROFESSIONAL', upToSeq)
    return toProfessionalConversation(conversation)
  })
}

export function closeProfessionalConversation(conversationId: string): Promise<ProfessionalConversation> {
  return respond(() => {
    const { professional, conversation } = professionalConversation(conversationId)
    requireApproved(professional.validationStatus)
    if (conversation.status === 'CLOSED') throw new AppError('INVALID_STATE_TRANSITION')
    conversation.status = 'CLOSED'
    conversation.closedBy = 'PROFESSIONAL'
    return toProfessionalConversation(conversation)
  })
}

export function reopenProfessionalConversation(conversationId: string): Promise<ProfessionalConversation> {
  return respond(() => {
    const { professional, conversation } = professionalConversation(conversationId)
    requireApproved(professional.validationStatus)
    if (conversation.status === 'OPEN' || conversation.closedBy !== 'PROFESSIONAL') throw new AppError('INVALID_STATE_TRANSITION')
    conversation.status = 'OPEN'
    conversation.closedBy = undefined
    return toProfessionalConversation(conversation)
  })
}

export function reportProfessionalMessage(conversationId: string, messageId: string, input: ReportMessageInput): Promise<MessageReportReceipt> {
  return respond(() => report(professionalConversation(conversationId).conversation, messageId, 'PROFESSIONAL', input))
}
