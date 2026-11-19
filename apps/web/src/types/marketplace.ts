/**
 * Tipos do mercado de profissionais do lado da família e do chat (MK2): `/marketplace/*`,
 * conversas da família, `/professional-portal/conversations*` e `/admin/message-reports*`.
 * Alinhados com `docs/05-api/openapi.yaml`; a API devolve `null` e a UI usa ausente (`undefined`).
 * O texto das mensagens é dado de saúde potencial (BR-MKT-46): nunca vai para logs.
 */
import type { OfferMethod, Specialty, SpecialtyCategory } from './professional'

export type RankingReason = 'COMPLETE_PROFILE' | 'GOOD_AVAILABILITY' | 'COMPETITIVE_PRICE' | 'ESTABLISHED'

export interface MarketplaceOffer {
  id: string
  specialtyId: string
  method: OfferMethod
  durationMinutes: number
  priceKz: number
  note?: string
}

export interface RankingExplanation {
  version: string
  score: number
  signals: { profileCompleteness: number; availability: number; price: number; seniority: number }
  /** Conjunto aberto: tolerar valores desconhecidos. */
  reasons: string[]
  label: string
}

export interface MarketplaceProfessionalItem {
  id: string
  displayName: string
  city: string
  specialties: Specialty[]
  matchingOffers: MarketplaceOffer[]
  fromPriceKz: number
  nextAvailableAt?: string
  ranking?: RankingExplanation
}

export interface MarketplaceProfessionalPage {
  items: MarketplaceProfessionalItem[]
  nextCursor: string | null
}

export interface MarketplaceProfessionalProfile {
  id: string
  displayName: string
  bio?: string
  city: string
  specialties: Specialty[]
  offers: MarketplaceOffer[]
  nextAvailableAt?: string
  /** Primeiro dia do mês da primeira aprovação (AAAA-MM-DD). */
  memberSince?: string
  ranking?: RankingExplanation
}

export type MarketplaceSort = 'RANKING' | 'PRICE_ASC' | 'PRICE_DESC' | 'NEXT_AVAILABLE'

export interface MarketplaceSearchParams {
  q?: string
  specialtyId?: string
  category?: SpecialtyCategory
  method?: OfferMethod
  city?: string
  minPriceKz?: number
  maxPriceKz?: number
  availableWithinDays?: number
  sort?: MarketplaceSort
  limit?: number
  cursor?: string
}

export interface MarketplaceFilters {
  specialties: Array<{ id: string; name: string; category: SpecialtyCategory; professionalCount: number }>
  cities: Array<{ name: string; professionalCount: number }>
  methods: OfferMethod[]
}

export interface ComparisonItem {
  professionalId: string
  displayName: string
  city: string
  offers: MarketplaceOffer[]
  fromPriceKz: number
  nextAvailableAt?: string
}

export interface ProfessionalComparison {
  specialtyId: string
  items: ComparisonItem[]
  priceSummary: Array<{ method: OfferMethod; minPriceKz: number; maxPriceKz: number; cheapestProfessionalIds: string[] }>
}

export interface RankingRules {
  version: string
  signals: Array<{ code: 'PROFILE_COMPLETENESS' | 'AVAILABILITY' | 'PRICE' | 'SENIORITY'; weightPercent: number; description: string }>
  notUsed: string[]
  statement: string
}

// ───── Conversas ─────

export type ConversationStatus = 'OPEN' | 'CLOSED'
export type ConversationClosedBy = 'FAMILY' | 'PROFESSIONAL' | 'SYSTEM'
export type ChatSide = 'FAMILY' | 'PROFESSIONAL'

export interface FamilyConversation {
  id: string
  memberId: string
  professional: { id: string; displayName: string; city?: string }
  participantLabel: string
  status: ConversationStatus
  closedBy?: ConversationClosedBy
  /** Derivado: `OPEN` e profissional `APPROVED`. */
  canSend: boolean
  lastMessageAt: string
  unreadCount: number
  createdAt: string
}

/** Vista do profissional: nunca contém ids de família, membro ou utilizador (BR-MKT-10/38). */
export interface ProfessionalConversation {
  id: string
  participantLabel: string
  status: ConversationStatus
  closedBy?: ConversationClosedBy
  canSend: boolean
  lastMessageAt: string
  unreadCount: number
  createdAt: string
}

export interface ChatMessage {
  id: string
  seq: number
  side: ChatSide
  mine: boolean
  /** Ausente quando `hidden` (moderação). */
  text?: string
  hidden: boolean
  createdAt: string
  readByOtherSide: boolean
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface StartConversationInput {
  professionalId: string
  participantLabel: string
  text: string
  clientMessageId?: string
}

export interface ConversationStarted {
  conversation: FamilyConversation
  message: ChatMessage
  /** `true` quando a conversa foi criada (`201`); `false` se já existia e a mensagem foi acrescentada (`200`). */
  created: boolean
}

export type MessageReportReason = 'ABUSE' | 'SPAM' | 'SCAM_OR_OFF_PLATFORM_PAYMENT' | 'SENSITIVE_DATA' | 'OTHER'

export interface ReportMessageInput {
  reason: MessageReportReason
  note?: string
}

export interface MessageReportReceipt {
  id: string
  status: 'OPEN' | 'DECIDED'
  reason: MessageReportReason
  createdAt: string
}

export type MessageReportDecision = 'DISMISS' | 'HIDE_MESSAGE' | 'HIDE_AND_CLOSE'

export interface AdminMessageReportItem {
  id: string
  status: 'OPEN' | 'DECIDED'
  reason: MessageReportReason
  reportedSide: ChatSide
  professionalId: string
  professionalDisplayName: string
  createdAt: string
}

export interface AdminReportContextMessage {
  id: string
  seq: number
  side: ChatSide
  text?: string
  hidden: boolean
  createdAt: string
}

/** BR-MKT-44: a denunciada e, no máximo, 2 anteriores; nunca família, membro nem `participantLabel`. */
export interface AdminMessageReportDetail {
  id: string
  status: 'OPEN' | 'DECIDED'
  reason: MessageReportReason
  note?: string
  reportedSide: ChatSide
  professional: { id: string; displayName: string; city?: string }
  reportedUserId?: string
  message: { id: string; text: string; hidden: boolean; createdAt: string }
  contextBefore: AdminReportContextMessage[]
  decision?: MessageReportDecision
  decidedAt?: string
  createdAt: string
}
