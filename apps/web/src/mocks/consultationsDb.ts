import type {
  BookingCancelledBy,
  BookingOfferSummary,
  BookingPaymentStatus,
  BookingStatus,
  BookingSystemReason,
  PaymentProofStatus,
  ProofContentType,
  ProofScanStatus,
  ReviewReply,
  ReviewReportReason,
} from '@/types/consultations'
import type { OfferMethod, ProfessionalOffer } from '@/types/professional'
import { marketplaceDb } from './marketplaceDb'
import { professionalDb } from './professionalDb'

/**
 * “Base de dados” em memória de MK3 (marcações, comprovativos, avaliações e denúncias). O estado de cada
 * marcação é a fonte do `Process` `BOOKING` (derivado, nunca escrito) e do estado de pagamento declarativo.
 * Os horários de profissionais sem horários reais (catálogo e contas sem regras) são gerados de forma
 * determinística (`offerSlots`) para a demonstração. Texto livre nunca sai daqui para logs (BR-MKT-63).
 */

const HOUR = 3_600_000
const DAY = 86_400_000

export interface MockBooking {
  id: string
  familyId: string
  memberId: string
  professionalId: string
  offerId: string
  slotId: string
  participantLabel: string
  offer: BookingOfferSummary
  priceKz: number
  startsAt: string
  endsAt: string
  status: BookingStatus
  paymentStatus: BookingPaymentStatus
  statusReason?: string
  cancelledBy?: BookingCancelledBy
  cancelledAt?: string
  systemReason?: BookingSystemReason
  meetingInfo?: string
  appointmentId?: string
  clientRequestId?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface MockProof {
  id: string
  bookingId: string
  status: PaymentProofStatus
  scanStatus: ProofScanStatus
  contentType: ProofContentType
  sizeBytes: number
  fileName: string
  decisionReason?: string
  disputeNote?: string
  disputeDecision?: 'CONFIRM_PAYMENT' | 'UPHOLD_REJECTION'
  decidedAt?: string
  disputedAt?: string
  purged: boolean
  createdAt: string
}

export interface MockReview {
  id: string
  bookingId: string
  professionalId: string
  specialtyId: string
  specialtyName: string
  method: OfferMethod
  rating: number
  comment?: string
  /** A nota conta mesmo com o comentário oculto (BR-MKT-60). */
  commentHiddenAt?: string
  reply?: ReviewReply
  consultedMonth: string
  createdAt: string
  updatedAt: string
}

export interface MockReviewReport {
  id: string
  reviewId: string
  reason: ReviewReportReason
  note?: string
  status: 'OPEN' | 'DECIDED'
  decision?: 'DISMISS' | 'HIDE_COMMENT'
  decidedAt?: string
  createdAt: string
}

interface ConsultationsDb {
  bookings: MockBooking[]
  proofs: MockProof[]
  reviews: MockReview[]
  reviewReports: MockReviewReport[]
  /** Conteúdo dos comprovativos (nunca sai do mock nem entra em respostas clonadas). */
  proofFiles: Map<string, Blob>
}

let seq = 0
export function consId(prefix: string): string {
  seq += 1
  return `${prefix}_${seq.toString(36)}${crypto.randomUUID().slice(0, 6)}`
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()
const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`

/** Instruções de pagamento por omissão do mock (texto do profissional, BR-MKT-26); placeholder de IBAN. */
export const DEFAULT_PAYMENT_INSTRUCTIONS = 'Transferência para o IBAN AO06 0000 0000 0000 0000 0000 0 e envio do comprovativo aqui. Indique o seu nome na transferência.'

// ───── Ofertas e horários ─────

export interface OfferFacts {
  professionalId: string
  offer: ProfessionalOffer
  specialtyName: string
  category: 'HEALTH' | 'WELLNESS'
  paymentInstructions: string
  /** Há horários reais (conta) ou simulados (catálogo e contas sem regras). */
  hasSlots: boolean
}

/** Oferta ativa de um profissional (conta ou catálogo); `undefined` se não existir ou estiver inativa. */
export function offerFacts(professionalId: string, offerId: string): OfferFacts | undefined {
  const account = professionalDb.professionals.find((p) => p.id === professionalId && p.displayName)
  const extra = marketplaceDb.catalogExtras.find((p) => p.id === professionalId)
  const offer = (account?.offers ?? extra?.offers ?? []).find((o) => o.id === offerId && o.active)
  if (!offer) return undefined
  const specialty = professionalDb.specialties.find((s) => s.id === offer.specialtyId)
  if (!specialty) return undefined
  return {
    professionalId,
    offer,
    specialtyName: specialty.name,
    category: specialty.category,
    paymentInstructions: account?.paymentInstructions ?? DEFAULT_PAYMENT_INSTRUCTIONS,
    hasSlots: extra ? extra.nextAvailableInDays !== undefined : true,
  }
}

export interface MockSlot {
  id: string
  offerId: string
  startsAt: string
  endsAt: string
}

/** Horas locais (Luanda, UTC+1) dos horários simulados. */
const VIRTUAL_HOURS_LUANDA = [9, 10, 11, 15, 16]

/** Horários (ocupados ou não) de uma oferta: os reais da conta, ou os simulados de segunda a sexta nas próximas 3 semanas. */
export function offerSlots(facts: OfferFacts): MockSlot[] {
  const account = professionalDb.professionals.find((p) => p.id === facts.professionalId)
  const real = account?.slots.filter((s) => s.offerId === facts.offer.id) ?? []
  if (real.length > 0) return real.map(({ id, offerId, startsAt, endsAt }) => ({ id, offerId, startsAt, endsAt }))
  if (!facts.hasSlots) return []
  const slots: MockSlot[] = []
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  for (let d = 1; d <= 21; d += 1) {
    const day = new Date(today.getTime() + d * DAY)
    const weekday = day.getUTCDay()
    if (weekday === 0 || weekday === 6) continue
    for (const hour of VIRTUAL_HOURS_LUANDA) {
      const start = new Date(day.getTime() + (hour - 1) * HOUR)
      slots.push({
        id: `slt_${facts.offer.id}_${start.toISOString().slice(0, 13).replace(/[-T]/g, '')}`,
        offerId: facts.offer.id,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + facts.offer.durationMinutes * 60_000).toISOString(),
      })
    }
  }
  return slots
}

/** Marcações que retêm o horário (BR-MKT-53). */
export const ACTIVE_STATUSES: BookingStatus[] = ['REQUESTED', 'CONFIRMED']

export function bookingHoldingSlot(slotId: string): MockBooking | undefined {
  return consultationsDb.bookings.find((b) => b.slotId === slotId && ACTIVE_STATUSES.includes(b.status))
}

/** Marcações ativas e futuras do profissional que se sobrepõem ao intervalo (veto de bloqueios, BR-MKT-53). */
export function activeBookingsOverlapping(professionalId: string, startMs: number, endMs: number): MockBooking[] {
  const now = Date.now()
  return consultationsDb.bookings.filter(
    (b) => b.professionalId === professionalId && ACTIVE_STATUSES.includes(b.status) && Date.parse(b.startsAt) > now && Date.parse(b.startsAt) < endMs && startMs < Date.parse(b.endsAt),
  )
}

// ───── Avaliações ─────

/** Avaliações de um profissional (as de todas as especialidades, ou só da indicada). */
export function reviewsOf(professionalId: string, specialtyId?: string): MockReview[] {
  return consultationsDb.reviews.filter((r) => r.professionalId === professionalId && (specialtyId === undefined || r.specialtyId === specialtyId))
}

/** Número e soma das notas (a nota conta mesmo com o comentário oculto). */
export function reviewStats(professionalId: string, specialtyId?: string): { count: number; sum: number } {
  const rows = reviewsOf(professionalId, specialtyId)
  return { count: rows.length, sum: rows.reduce((total, r) => total + r.rating, 0) }
}

// ───── Seed ─────

function seed(): ConsultationsDb {
  const bookings: MockBooking[] = []
  const proofs: MockProof[] = []
  const reviews: MockReview[] = []
  const proofFiles = new Map<string, Blob>()

  function booking(id: string, professionalId: string, offerId: string, memberId: string, label: string, startsInMs: number, status: BookingStatus, paymentStatus: BookingPaymentStatus, extra: Partial<MockBooking> = {}) {
    const facts = offerFacts(professionalId, offerId)
    if (!facts) throw new Error(`Oferta de demonstração inexistente: ${offerId}`)
    const startsAt = startsInMs >= 0 ? ahead(startsInMs) : ago(-startsInMs)
    // Futuras: pedidas há 6 h (dentro das 48 h de resposta); passadas: pedidas 3 dias antes da hora.
    const created = startsInMs >= 0 ? Date.now() - 6 * HOUR : Date.now() + startsInMs - 3 * DAY
    bookings.push({
      id,
      familyId: 'fam_monarca',
      memberId,
      professionalId,
      offerId,
      slotId: `slt_seed_${id}`,
      participantLabel: label,
      offer: { specialtyId: facts.offer.specialtyId, specialtyName: facts.specialtyName, category: facts.category, method: facts.offer.method, durationMinutes: facts.offer.durationMinutes },
      priceKz: facts.offer.priceKz,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + facts.offer.durationMinutes * 60_000).toISOString(),
      status,
      paymentStatus,
      createdAt: new Date(created).toISOString(),
      updatedAt: new Date(Math.min(Date.now(), created + 6 * HOUR)).toISOString(),
      ...extra,
    })
  }

  function proof(id: string, bookingId: string, status: PaymentProofStatus, extra: Partial<MockProof> = {}) {
    proofs.push({ id, bookingId, status, scanStatus: 'CLEAN', contentType: 'application/pdf', sizeBytes: 184_000, fileName: `${id}.pdf`, purged: false, createdAt: ago(2 * DAY), ...extra })
    proofFiles.set(id, new Blob([`Comprovativo simulado ${id}`], { type: 'application/pdf' }))
  }

  // Marcações da família demo (mem_monarca e mem_pedro, dependente).
  booking('bkg_seed_req', 'pro_pub_psico1', 'ofr_pub_2', 'mem_monarca', 'Monarca', 3 * DAY, 'REQUESTED', 'AWAITING_PROOF')
  booking('bkg_seed_conf', 'pro_pub_nutri1', 'ofr_pub_8', 'mem_pedro', 'Pedro', 2 * DAY, 'CONFIRMED', 'AWAITING_PROOF')
  booking('bkg_seed_done', 'pro_pub_psico3', 'ofr_pub_6', 'mem_monarca', 'Monarca', -5 * DAY, 'COMPLETED', 'CONFIRMED', {
    meetingInfo: 'https://meet.exemplo.ao/sala-teresa',
    completedAt: ago(5 * DAY - HOUR),
  })
  booking('bkg_seed_disp', 'pro_pub_nutri1', 'ofr_pub_7', 'mem_monarca', 'Monarca', -10 * DAY, 'COMPLETED', 'DISPUTED', { completedAt: ago(10 * DAY - HOUR) })
  proof('prf_seed_disp', 'bkg_seed_disp', 'DISPUTED', {
    decisionReason: 'Não encontro a transferência na minha conta.',
    disputeNote: 'Paguei no dia da consulta; o comprovativo do banco está anexado.',
    decidedAt: ago(8 * DAY),
    disputedAt: ago(7 * DAY),
    createdAt: ago(9 * DAY),
  })
  // Marcações da conta de demonstração do portal (Marta Lopes, `pro_aprovada`).
  booking('bkg_seed_pa_req', 'pro_aprovada', 'ofr_ap_1', 'mem_pedro', 'Pai do Pedro', 4 * DAY, 'REQUESTED', 'AWAITING_PROOF')
  booking('bkg_seed_pa_conf', 'pro_aprovada', 'ofr_ap_1', 'mem_monarca', 'Monarca', DAY, 'CONFIRMED', 'PROOF_SUBMITTED')
  proof('prf_seed_pa_conf', 'bkg_seed_pa_conf', 'SUBMITTED', { createdAt: ago(3 * HOUR) })
  booking('bkg_seed_pa_done', 'pro_aprovada', 'ofr_ap_1', 'mem_monarca', 'Monarca', -3 * DAY, 'COMPLETED', 'CONFIRMED', { completedAt: ago(3 * DAY - HOUR) })

  // Avaliações verificadas (anónimas). A de `pro_pub_psico1` com texto original oculto mostra a moderação.
  function review(id: string, professionalId: string, offerId: string, rating: number, ageDays: number, extra: Partial<MockReview> = {}) {
    const facts = offerFacts(professionalId, offerId)
    if (!facts) throw new Error(`Oferta de demonstração inexistente: ${offerId}`)
    const created = ago(ageDays * DAY)
    reviews.push({
      id,
      bookingId: `bkg_hist_${id}`,
      professionalId,
      specialtyId: facts.offer.specialtyId,
      specialtyName: facts.specialtyName,
      method: facts.offer.method,
      rating,
      consultedMonth: monthOf(ago((ageDays + 2) * DAY)),
      createdAt: created,
      updatedAt: created,
      ...extra,
    })
  }
  review('rev_p1_1', 'pro_pub_psico1', 'ofr_pub_2', 5, 40, { comment: 'Muito atenciosa e pontual. Voltaria a marcar.', reply: { text: 'Obrigada pela confiança!', repliedAt: ago(39 * DAY) } })
  review('rev_p1_2', 'pro_pub_psico1', 'ofr_pub_1', 5, 25, { comment: 'Ambiente calmo e conversa útil.' })
  review('rev_p1_3', 'pro_pub_psico1', 'ofr_pub_2', 4, 15, { comment: 'Boa consulta; a ligação falhou um pouco no início.' })
  review('rev_p1_4', 'pro_pub_psico1', 'ofr_pub_2', 5, 6, { comment: 'Comentário ocultado nesta demonstração.', commentHiddenAt: ago(5 * DAY) })
  review('rev_p3_1', 'pro_pub_psico3', 'ofr_pub_4', 4, 33, { comment: 'Explicou tudo com calma.' })
  review('rev_p3_2', 'pro_pub_psico3', 'ofr_pub_6', 4, 18)
  review('rev_p3_3', 'pro_pub_psico3', 'ofr_pub_4', 5, 9, { comment: 'Excelente com crianças.' })
  review('rev_n1_1', 'pro_pub_nutri1', 'ofr_pub_7', 5, 12, { comment: 'Plano claro e fácil de seguir.' })
  review('rev_pa_1', 'pro_aprovada', 'ofr_ap_1', 5, 14, { comment: 'Aulas muito boas para iniciantes.', reply: { text: 'Fico contente. Até breve!', repliedAt: ago(13 * DAY) } })
  review('rev_pa_2', 'pro_aprovada', 'ofr_ap_1', 4, 5, { comment: 'Gostei; o estúdio podia ter mais ventilação.' })

  const reviewReports: MockReviewReport[] = [
    { id: 'rrp_seed_1', reviewId: 'rev_p1_3', reason: 'OFF_TOPIC', note: 'Fala da ligação e não do serviço.', status: 'OPEN', createdAt: ago(DAY) },
  ]
  return { bookings, proofs, reviews, reviewReports, proofFiles }
}

export let consultationsDb: ConsultationsDb = seed()

export function resetConsultationsDb() {
  consultationsDb = seed()
}
