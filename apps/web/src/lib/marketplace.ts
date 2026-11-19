import type { Tone } from '@/components/ui/Badge'
import type { ChatSide, ConversationClosedBy, MarketplaceSort, MessageReportDecision, MessageReportReason, RankingRules } from '@/types/marketplace'
import type { SpecialtyCategory } from '@/types/professional'

/** Textos em pt-AO do mercado (descoberta e chat, MK2). */

/** Aviso fixo antes de escrever (BR-MKT-46, OP-85): em MK2 não há referência à partilha com prazo. */
export const CHAT_WARNING = 'Não envie dados de saúde sensíveis por aqui.'
export const CHAT_MAX_LENGTH = 1000
export const PARTICIPANT_LABEL_MAX = 40
export const REPORT_NOTE_MAX = 300
export const REPORT_ADMIN_NOTICE = 'A Vita Family só verá esta mensagem e as 2 anteriores da conversa.'

export const categoryNotice: Record<SpecialtyCategory, string> = {
  HEALTH: 'Não substitui atendimento de urgência.',
  WELLNESS: 'Serviço de bem-estar; não é um ato de saúde nem substitui o seu médico.',
}

export const sortLabel: Record<MarketplaceSort, string> = {
  RANKING: 'Melhores',
  PRICE_ASC: 'Preço (do mais baixo)',
  PRICE_DESC: 'Preço (do mais alto)',
  NEXT_AVAILABLE: 'Mais cedo disponível',
}

/** Conjunto aberto: razões desconhecidas ficam sem texto (a UI ignora-as). */
export const rankingReasonLabel: Record<string, string> = {
  GOOD_REVIEWS: 'Bem avaliado',
  COMPLETE_PROFILE: 'Perfil completo',
  GOOD_AVAILABILITY: 'Boa disponibilidade',
  COMPETITIVE_PRICE: 'Preço competitivo',
  ESTABLISHED: 'Na plataforma há algum tempo',
}

/** `RATED` não leva etiqueta: a nota é mostrada à parte (resumo das avaliações). */
export const rankingLabelText: Record<string, string> = { NEW: 'Novo' }

export const rankingSignalLabel: Record<RankingRules['signals'][number]['code'], string> = {
  REVIEWS: 'Avaliações de quem consultou',
  PROFILE_COMPLETENESS: 'Perfil completo',
  AVAILABILITY: 'Disponibilidade',
  PRICE: 'Preço',
  SENIORITY: 'Antiguidade na plataforma',
}

export function reasonTexts(reasons: string[]): string[] {
  return reasons.map((r) => rankingReasonLabel[r]).filter((text): text is string => Boolean(text))
}

export const reportReasonLabel: Record<MessageReportReason, string> = {
  ABUSE: 'Abuso ou ofensas',
  SPAM: 'Spam',
  SCAM_OR_OFF_PLATFORM_PAYMENT: 'Pagamento fora da plataforma ou esquema',
  SENSITIVE_DATA: 'Dados sensíveis',
  OTHER: 'Outro motivo',
}

export const REPORT_REASONS = Object.keys(reportReasonLabel) as MessageReportReason[]

export const decisionLabel: Record<MessageReportDecision, string> = {
  DISMISS: 'Arquivar',
  HIDE_MESSAGE: 'Ocultar mensagem',
  HIDE_AND_CLOSE: 'Ocultar e fechar a conversa',
}

export const decisionHint: Record<MessageReportDecision, string> = {
  DISMISS: 'A denúncia não tem seguimento; a mensagem continua visível.',
  HIDE_MESSAGE: 'A mensagem deixa de ser visível para os participantes.',
  HIDE_AND_CLOSE: 'Oculta a mensagem e fecha a conversa (não se reabre).',
}

export const sideLabel: Record<ChatSide, string> = { FAMILY: 'Família', PROFESSIONAL: 'Profissional' }

export const closedByLabel: Record<ConversationClosedBy, string> = {
  FAMILY: 'Fechada pela família',
  PROFESSIONAL: 'Fechada pelo profissional',
  SYSTEM: 'Fechada pela moderação',
}

export const reportStatusTone: Record<'OPEN' | 'DECIDED', Tone> = { OPEN: 'warning', DECIDED: 'neutral' }
export const reportStatusLabel: Record<'OPEN' | 'DECIDED', string> = { OPEN: 'Por decidir', DECIDED: 'Decidida' }

/** Texto livre normalizado como o servidor: aparado; 1–1000 sem caracteres de controlo (exceto quebra de linha). */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/
export function validMessageText(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length < 1 || trimmed.length > CHAT_MAX_LENGTH || CONTROL.test(trimmed)) return null
  return trimmed
}

/** Uma conversa fechada/inativa fica só de leitura; devolve o motivo em linguagem simples ou `null` se pode enviar. */
export function readOnlyNotice(canSend: boolean, status: 'OPEN' | 'CLOSED', closedBy?: ConversationClosedBy, side: ChatSide = 'FAMILY'): string | null {
  if (canSend) return null
  if (status === 'CLOSED') {
    if (closedBy === 'SYSTEM') return 'Esta conversa foi fechada pela moderação. Continua legível, mas já não aceita mensagens.'
    return side === 'FAMILY' && closedBy === 'FAMILY'
      ? 'Arrumou esta conversa. Pode reabri-la para voltar a escrever.'
      : 'Esta conversa está fechada. Continua legível, mas já não aceita mensagens.'
  }
  return side === 'FAMILY'
    ? 'Este profissional está indisponível. A conversa continua legível, mas já não aceita mensagens.'
    : 'A sua conta já não está aprovada: as conversas ficam só de leitura.'
}
