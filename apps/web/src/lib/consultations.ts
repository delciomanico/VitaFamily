import type { Tone } from '@/components/ui/Badge'
import { isAppError } from '@/lib/errors'
import type {
  BookingCancelledBy,
  BookingPaymentStatus,
  BookingStatus,
  BookingSystemReason,
  PaymentDisputeDecision,
  PaymentProofStatus,
  ProofContentType,
  ReviewReportDecision,
  ReviewReportReason,
} from '@/types/consultations'

/** Textos em pt-AO de marcação, comprovativo e avaliações (MK3). Sem vocabulário técnico para a família. */

/**
 * Marca de texto legal provisório (OP-112, gate de lançamento): os textos marcados com `[PROVISÓRIO]` são
 * placeholders até o proprietário/jurista fornecer os definitivos; não são aconselhamento jurídico.
 */
export const LEGAL_PLACEHOLDER_TAG = '[PROVISÓRIO]'

/** Aviso da marcação sobre o pagamento fora da aplicação (BR-MKT-56). */
export const PAYMENT_OUTSIDE_APP_NOTICE = `${LEGAL_PLACEHOLDER_TAG} O pagamento é feito diretamente ao profissional, fora da aplicação. A Vita Family não recebe nem confirma pagamentos.`
/** Aviso do comprovativo (BR-MKT-57, OP-99, OP-112). */
export const PROOF_NOTICE = `${LEGAL_PLACEHOLDER_TAG} Oculte no comprovativo os dados que não sejam necessários. O ficheiro é guardado de forma restrita e apagado ao fim de 24 meses.`
/** Política de cancelamento exibida na marcação (BR-MKT-52, OP-112). */
export const CANCELLATION_NOTICE = `${LEGAL_PLACEHOLDER_TAG} Pode cancelar até à hora da consulta. Cancelar com menos de 24 horas de antecedência é considerado «em cima da hora». Eventuais reembolsos combinam-se diretamente com o profissional.`
/** Termos do mercado para a família (marcar, pagar fora da aplicação, avaliar). */
export const MARKET_TERMS_NOTICE = `${LEGAL_PLACEHOLDER_TAG} Ao marcar, aceita os termos do mercado de profissionais: a marcação é um acordo entre si e o profissional; a Vita Family apenas faz a ligação.`
/** Aviso ao avaliar (BR-MKT-59/63, OP-112). */
export const REVIEW_NOTICE = 'Não escreva dados de saúde. A sua avaliação é anónima e pública.'
export const REVIEW_LEGAL_NOTICE = `${LEGAL_PLACEHOLDER_TAG} Só pode avaliar quem consultou. O comentário pode ser ocultado pela moderação se não cumprir as regras.`
/** Texto-guia ao escrever motivos para a família (BR-MKT-63). */
export const NO_HEALTH_DATA_HINT = 'Não escreva dados de saúde.'
/** Aviso ao profissional que decide um comprovativo. */
export const PROFESSIONAL_PROOF_NOTICE = `${LEGAL_PLACEHOLDER_TAG} O comprovativo é um ficheiro enviado pela família: confirme apenas o que verificou na sua conta. A Vita Family não valida o dinheiro.`

export const PARTICIPANT_LABEL_MAX = 40
export const NOTE_MAX = 300
export const MEETING_INFO_MAX = 300
export const REVIEW_COMMENT_MAX = 500
export const REPLY_MAX = 500
export const PROOF_MAX_BYTES = 10 * 1024 * 1024
export const PROOF_TYPES: ProofContentType[] = ['application/pdf', 'image/jpeg', 'image/png']
/** Cancelar com menos de 24 h até à hora é «em cima da hora» (só informativo). */
export const LATE_CANCEL_MS = 24 * 3_600_000

export interface StatusText {
  label: string
  tone: Tone
}

/** Estado da marcação, na linguagem da família. */
export const bookingStatusText: Record<BookingStatus, StatusText> = {
  REQUESTED: { label: 'A aguardar resposta do profissional', tone: 'warning' },
  CONFIRMED: { label: 'Confirmada', tone: 'success' },
  REJECTED: { label: 'Recusada', tone: 'neutral' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
  COMPLETED: { label: 'Realizada', tone: 'primary' },
  NO_SHOW: { label: 'Faltou', tone: 'danger' },
}

/** Estado da marcação no portal do profissional. */
export const professionalBookingStatusText: Record<BookingStatus, StatusText> = {
  REQUESTED: { label: 'Por responder', tone: 'warning' },
  CONFIRMED: { label: 'Confirmada', tone: 'success' },
  REJECTED: { label: 'Recusada', tone: 'neutral' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
  COMPLETED: { label: 'Concluída', tone: 'primary' },
  NO_SHOW: { label: 'Falta', tone: 'danger' },
}

export const BOOKING_STATUSES = Object.keys(bookingStatusText) as BookingStatus[]

/** Estado do pagamento (declarativo, fora da aplicação). */
export const paymentStatusText: Record<BookingPaymentStatus, StatusText> = {
  NOT_REQUIRED: { label: 'Sem pagamento', tone: 'neutral' },
  AWAITING_PROOF: { label: 'Falta o comprovativo', tone: 'warning' },
  PROOF_SUBMITTED: { label: 'Comprovativo enviado', tone: 'primary' },
  CONFIRMED: { label: 'Pagamento confirmado', tone: 'success' },
  REJECTED: { label: 'Comprovativo recusado', tone: 'danger' },
  DISPUTED: { label: 'Em análise pela Vita Family', tone: 'warning' },
}

export const proofStatusText: Record<PaymentProofStatus, StatusText> = {
  SUBMITTED: { label: 'Enviado', tone: 'primary' },
  CONFIRMED: { label: 'Confirmado', tone: 'success' },
  REJECTED: { label: 'Recusado', tone: 'danger' },
  DISPUTED: { label: 'Em análise', tone: 'warning' },
  REJECTION_UPHELD: { label: 'Recusa mantida', tone: 'danger' },
}

export const proofTypeLabel: Record<ProofContentType, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
}

/** Quem cancelou e porquê, em frase simples (BR-MKT-54). */
export function cancellationText(cancelledBy: BookingCancelledBy | undefined, systemReason?: BookingSystemReason, side: 'FAMILY' | 'PROFESSIONAL' = 'FAMILY'): string {
  if (cancelledBy === 'FAMILY') return side === 'FAMILY' ? 'Cancelada por si.' : 'Cancelada pela família.'
  if (cancelledBy === 'PROFESSIONAL') return side === 'FAMILY' ? 'Cancelada pelo profissional.' : 'Cancelada por si.'
  if (systemReason === 'PROFESSIONAL_UNAVAILABLE') return 'Cancelada: o profissional ficou indisponível.'
  if (systemReason === 'REQUEST_EXPIRED') return 'Cancelada: o pedido não foi respondido a tempo.'
  return 'Cancelada.'
}

export const reviewReportReasonLabel: Record<ReviewReportReason, string> = {
  ABUSE: 'Abuso ou ofensas',
  PERSONAL_DATA: 'Dados pessoais',
  OFF_TOPIC: 'Fora do assunto',
  OTHER: 'Outro motivo',
}
export const REVIEW_REPORT_REASONS = Object.keys(reviewReportReasonLabel) as ReviewReportReason[]

export const disputeDecisionLabel: Record<PaymentDisputeDecision, string> = {
  CONFIRM_PAYMENT: 'Confirmar o pagamento',
  UPHOLD_REJECTION: 'Manter a recusa',
}
export const disputeDecisionHint: Record<PaymentDisputeDecision, string> = {
  CONFIRM_PAYMENT: 'O comprovativo passa a confirmado e o pagamento da marcação fica confirmado.',
  UPHOLD_REJECTION: 'A recusa do profissional mantém-se e o pagamento fica recusado.',
}

export const reviewDecisionLabel: Record<ReviewReportDecision, string> = {
  DISMISS: 'Arquivar',
  HIDE_COMMENT: 'Ocultar o comentário',
}
export const reviewDecisionHint: Record<ReviewReportDecision, string> = {
  DISMISS: 'A denúncia não tem seguimento; a avaliação continua visível.',
  HIDE_COMMENT: 'O comentário deixa de ser visível; a nota continua a contar.',
}

export const queueStatusLabel: Record<'OPEN' | 'DECIDED' | 'DISPUTED', StatusText> = {
  OPEN: { label: 'Por decidir', tone: 'warning' },
  DISPUTED: { label: 'Por decidir', tone: 'warning' },
  DECIDED: { label: 'Decidida', tone: 'neutral' },
}

/** O estado mudou entretanto: o mock devolve `INVALID_STATE_TRANSITION`; a API real chega como `CONFLICT` (apiClient). */
export const isStateChange = (error: unknown): boolean => isAppError(error, 'INVALID_STATE_TRANSITION') || isAppError(error, 'CONFLICT')

/** Texto livre normalizado como o servidor: aparado; sem caracteres de controlo (exceto quebra de linha). */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/
export function plainText(text: string, maxLength: number, { required = false }: { required?: boolean } = {}): string | null {
  const trimmed = text.trim()
  if ((required && trimmed.length < 1) || trimmed.length > maxLength || CONTROL.test(trimmed)) return null
  return trimmed
}

/** Primeiro dia do mês (AAAA-MM-DD) em «mês de ano» pt-AO. */
export function formatMonth(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number)
  if (!year || !month) return ''
  return new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)))
}

/** Média com vírgula decimal («4,8»). */
export function formatRating(value: number): string {
  return value.toFixed(1).replace('.', ',')
}

/** Aceita o ficheiro de um comprovativo? Devolve o erro a mostrar, ou `null`. */
export function proofFileError(file: { type: string; size: number }): 'FILE_TYPE_NOT_ALLOWED' | 'FILE_TOO_LARGE' | null {
  if (!PROOF_TYPES.includes(file.type as ProofContentType)) return 'FILE_TYPE_NOT_ALLOWED'
  if (file.size > PROOF_MAX_BYTES) return 'FILE_TOO_LARGE'
  return null
}
