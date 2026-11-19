import { beforeEach, describe, expect, it } from 'vitest'
import { professionalSessionStore } from '@/lib/storage'
import { db, resetDb } from '../db'
import { consultationsDb, resetConsultationsDb } from '../consultationsDb'
import { resetMarketplaceDb } from '../marketplaceDb'
import { professionalDb, resetProfessionalDb } from '../professionalDb'
import * as admin from './adminConsultations'
import * as cs from './consultations'
import * as marketplace from './marketplace'
import * as pb from './professionalBookings'
import * as portal from './professionalPortal'
import { getProcess } from './processes'

const F = 'fam_monarca'
const U = 'usr_monarca'
const ME = 'mem_monarca'
const PEDRO = 'mem_pedro'
const PSICO1 = 'pro_pub_psico1'
const PSICO1_VIDEO = 'ofr_pub_2'
const PA = 'pro_aprovada'
const PA_OFFER = 'ofr_ap_1'
const DAY = 86_400_000

const pdf = (name = 'comprovativo.pdf') => new File([new Uint8Array(100)], name, { type: 'application/pdf' })
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: { code: string }) => e.code,
  )
const signIn = (id: string) => professionalSessionStore.setAccountId(id)

async function firstSlot(professionalId: string, offerId: string, skip = 0) {
  const slots = await cs.listBookableSlots(professionalId, offerId, new Date(Date.now() + 3 * DAY).toISOString(), new Date(Date.now() + 20 * DAY).toISOString())
  const slot = slots[skip]
  if (!slot) throw new Error('sem horários de teste')
  return slot
}

async function book(professionalId = PSICO1, offerId = PSICO1_VIDEO, memberId = ME, skip = 0) {
  const slot = await firstSlot(professionalId, offerId, skip)
  return cs.createBooking(F, U, memberId, { offerId, slotId: slot.id, participantLabel: 'Monarca' })
}

/** Põe uma marcação do portal no passado para poder concluí-la. */
function inThePast(bookingId: string) {
  const b = consultationsDb.bookings.find((x) => x.id === bookingId)!
  b.startsAt = new Date(Date.now() - 2 * 3_600_000).toISOString()
  b.endsAt = new Date(Date.now() - 3_600_000).toISOString()
}

beforeEach(() => {
  resetDb()
  resetMarketplaceDb()
  resetProfessionalDb()
  resetConsultationsDb()
  window.sessionStorage.clear()
})

// ───── Horários livres ─────

describe('horários livres', () => {
  it('só futuros, ordenados e sem os ocupados', async () => {
    const before = await cs.listBookableSlots(PSICO1, PSICO1_VIDEO)
    expect(before.length).toBeGreaterThan(0)
    const times = before.map((s) => s.startsAt)
    expect(times).toEqual([...times].sort())
    const booked = await cs.createBooking(F, U, ME, { offerId: PSICO1_VIDEO, slotId: before[0]!.id, participantLabel: 'Monarca' }).catch(() => undefined)
    if (booked) expect((await cs.listBookableSlots(PSICO1, PSICO1_VIDEO)).map((s) => s.id)).not.toContain(before[0]!.id)
  })

  it('profissional inexistente, não aprovado ou oferta alheia ⇒ NOT_FOUND; intervalo de mais de 62 dias ⇒ VALIDATION_ERROR', async () => {
    expect(await code(cs.listBookableSlots('pro_fila', 'x'))).toBe('NOT_FOUND')
    expect(await code(cs.listBookableSlots(PSICO1, 'ofr_pub_9'))).toBe('NOT_FOUND')
    expect(await code(cs.listBookableSlots(PSICO1, PSICO1_VIDEO, new Date().toISOString(), new Date(Date.now() + 70 * DAY).toISOString()))).toBe('VALIDATION_ERROR')
  })

  it('profissional sem horários (Sofia Domingos) devolve lista vazia', async () => {
    expect(await cs.listBookableSlots('pro_pub_treino1', 'ofr_pub_9')).toEqual([])
  })
})

// ───── Marcar ─────

describe('marcar uma consulta', () => {
  it('cria REQUESTED com preço copiado, pagamento por enviar, sem instruções e processo «o profissional ainda tem de responder»', async () => {
    const booking = await book()
    expect(booking).toMatchObject({ status: 'REQUESTED', paymentStatus: 'AWAITING_PROOF', priceKz: 15000, canCancel: true, canSendProof: false, canReview: false })
    expect(booking.paymentInstructions).toBeUndefined()
    expect(booking.meetingInfo).toBeUndefined()
    const process = await getProcess(F, U, ME, booking.processId!)
    expect(process.origin).toEqual({ type: 'BOOKING', id: booking.id })
    expect(process.nextStep).toEqual({ code: 'AWAIT_PROFESSIONAL_RESPONSE', actor: 'PROFESSIONAL' })
  })

  it('o mesmo horário duas vezes ⇒ SLOT_UNAVAILABLE; o mesmo clientRequestId devolve a marcação existente', async () => {
    const slot = await firstSlot(PSICO1, PSICO1_VIDEO)
    const input = { offerId: PSICO1_VIDEO, slotId: slot.id, participantLabel: 'Monarca', clientRequestId: crypto.randomUUID() }
    const first = await cs.createBooking(F, U, ME, input)
    expect((await cs.createBooking(F, U, ME, input)).id).toBe(first.id)
    expect(await code(cs.createBooking(F, U, PEDRO, { ...input, clientRequestId: undefined }))).toBe('SLOT_UNAVAILABLE')
  })

  it('validações: rótulo vazio ou > 40, antecedência < 2 h, sobreposição do membro', async () => {
    const slot = await firstSlot(PSICO1, PSICO1_VIDEO)
    expect(await code(cs.createBooking(F, U, ME, { offerId: PSICO1_VIDEO, slotId: slot.id, participantLabel: '  ' }))).toBe('VALIDATION_ERROR')
    expect(await code(cs.createBooking(F, U, ME, { offerId: PSICO1_VIDEO, slotId: slot.id, participantLabel: 'x'.repeat(41) }))).toBe('VALIDATION_ERROR')
    expect(await code(cs.createBooking(F, U, ME, { offerId: PSICO1_VIDEO, slotId: 'slt_inexistente', participantLabel: 'Monarca' }))).toBe('NOT_FOUND')
    const first = await book()
    // Outro profissional, no mesmo instante, para o mesmo membro ⇒ CONFLICT.
    const other = (await cs.listBookableSlots('pro_pub_psico3', 'ofr_pub_6', new Date(Date.parse(first.startsAt) - 1000).toISOString(), new Date(Date.parse(first.startsAt) + DAY).toISOString()))[0]!
    expect(other.startsAt).toBe(first.startsAt)
    expect(await code(cs.createBooking(F, U, ME, { offerId: 'ofr_pub_6', slotId: other.id, participantLabel: 'Monarca' }))).toBe('CONFLICT')
  })

  it('autorização: outro adulto com conta ⇒ FORBIDDEN; membro de outra família ⇒ NOT_FOUND', async () => {
    const slot = await firstSlot(PSICO1, PSICO1_VIDEO)
    const input = { offerId: PSICO1_VIDEO, slotId: slot.id, participantLabel: 'Ana' }
    expect(await code(cs.createBooking(F, U, 'mem_ana', input))).toBe('FORBIDDEN')
    expect(await code(cs.createBooking('fam_outra', U, ME, input))).toBe('NOT_FOUND')
  })

  it('utilizador com o mesmo e-mail do profissional ⇒ SELF_BOOKING_NOT_ALLOWED', async () => {
    const pro = professionalDb.professionals.find((p) => p.id === PA)!
    db.users.find((u) => u.id === U)!.email = pro.email
    const slot = await firstSlot(PA, PA_OFFER)
    expect(await code(cs.createBooking(F, U, ME, { offerId: PA_OFFER, slotId: slot.id, participantLabel: 'Monarca' }))).toBe('SELF_BOOKING_NOT_ALLOWED')
  })

  it('cancelar liberta o horário; só terminal ou hora passada ⇒ INVALID_STATE_TRANSITION', async () => {
    const booking = await book()
    const cancelled = await cs.cancelFamilyBooking(F, U, ME, booking.id, 'Imprevisto')
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledBy: 'FAMILY', canCancel: false })
    expect((await cs.listBookableSlots(PSICO1, PSICO1_VIDEO, new Date(Date.parse(booking.startsAt) - 1000).toISOString(), new Date(Date.parse(booking.startsAt) + 1000).toISOString())).map((s) => s.startsAt)).toContain(booking.startsAt)
    expect(await code(cs.cancelFamilyBooking(F, U, ME, booking.id))).toBe('INVALID_STATE_TRANSITION')
    expect((await getProcess(F, U, ME, booking.processId!)).familyStatus).toBe('CANCELLED')
  })

  it('a lista traz as marcações do membro (mais recentes primeiro) e filtra por estado', async () => {
    const all = await cs.listFamilyBookings(F, U, ME)
    const starts = all.items.map((b) => b.startsAt)
    expect(starts).toEqual([...starts].sort().reverse())
    const done = await cs.listFamilyBookings(F, U, ME, { status: 'COMPLETED' })
    expect(done.items.length).toBeGreaterThan(0)
    expect(done.items.every((b) => b.status === 'COMPLETED')).toBe(true)
    expect(all.items.every((b) => b.paymentInstructions === undefined)).toBe(true)
  })
})

// ───── Portal do profissional: marcações ─────

describe('portal do profissional: marcações', () => {
  it('a vista nunca traz ids de família, membro ou utilizador', async () => {
    signIn(PA)
    const page = await pb.listProfessionalBookings({})
    expect(page.items.length).toBeGreaterThan(0)
    const text = JSON.stringify(page)
    for (const forbidden of ['fam_monarca', 'mem_monarca', 'mem_pedro', 'usr_monarca', 'familyId', 'memberId', 'userId']) expect(text).not.toContain(forbidden)
    expect(page.items.every((b) => ['REQUESTED', 'CONFIRMED'].includes(b.status))).toBe(true)
  })

  it('marcação de outro profissional ⇒ NOT_FOUND', async () => {
    signIn(PA)
    expect(await code(pb.getProfessionalBooking('bkg_seed_req'))).toBe('NOT_FOUND')
  })

  it('confirmar cria a consulta gerida pela marcação, mostra ligação e instruções e abre o pagamento; a consulta não se edita', async () => {
    const booking = await book(PA, PA_OFFER, PEDRO)
    signIn(PA)
    const confirmed = await pb.confirmBooking(booking.id)
    expect(confirmed.status).toBe('CONFIRMED')
    const family = await cs.getFamilyBooking(F, U, PEDRO, booking.id)
    expect(family.appointmentId).toBeDefined()
    expect(family.paymentInstructions).toContain('IBAN')
    expect(family).toMatchObject({ canSendProof: true, canCancel: true })
    expect((await getProcess(F, U, PEDRO, booking.processId!)).nextStep).toEqual({ code: 'SEND_PAYMENT_PROOF', actor: 'FAMILY' })
    const appointment = db.appointments.find((a) => a.id === family.appointmentId)!
    expect(appointment).toMatchObject({ status: 'SCHEDULED', bookingId: booking.id })
    // Cancelar pelo profissional cancela também a consulta.
    await pb.cancelProfessionalBooking(booking.id, 'Imprevisto')
    expect(appointment.status).toBe('CANCELLED')
  })

  it('em vídeo/telefone a ligação é obrigatória; recusar exige motivo; pedido já decidido ⇒ INVALID_STATE_TRANSITION', async () => {
    // Sem conta de profissional com vídeo: ajusta a oferta da conta para VIDEO.
    professionalDb.professionals.find((p) => p.id === PA)!.offers[0]!.method = 'VIDEO'
    const booking = await book(PA, PA_OFFER, PEDRO)
    signIn(PA)
    expect(await code(pb.confirmBooking(booking.id))).toBe('VALIDATION_ERROR')
    expect((await pb.confirmBooking(booking.id, 'https://meet.exemplo.ao/marta')).meetingInfo).toContain('meet.exemplo.ao')
    expect(await code(pb.confirmBooking(booking.id, 'x'))).toBe('INVALID_STATE_TRANSITION')
    expect(await code(pb.rejectBooking('bkg_seed_pa_req', ' '))).toBe('VALIDATION_ERROR')
    const rejected = await pb.rejectBooking('bkg_seed_pa_req', 'Indisponível nesse dia')
    expect(rejected.status).toBe('REJECTED')
    expect((await cs.getFamilyBooking(F, U, PEDRO, 'bkg_seed_pa_req')).statusReason).toBe('Indisponível nesse dia')
  })

  it('pedido sem resposta há mais de 48 h já não se confirma', async () => {
    signIn(PA)
    consultationsDb.bookings.find((b) => b.id === 'bkg_seed_pa_req')!.createdAt = new Date(Date.now() - 49 * 3_600_000).toISOString()
    expect(await code(pb.confirmBooking('bkg_seed_pa_req'))).toBe('INVALID_STATE_TRANSITION')
  })

  it('concluir só depois da hora; falta fecha o processo como «voltar a marcar»', async () => {
    signIn(PA)
    expect(await code(pb.completeBooking('bkg_seed_pa_conf'))).toBe('INVALID_STATE_TRANSITION')
    inThePast('bkg_seed_pa_conf')
    expect((await pb.markBookingNoShow('bkg_seed_pa_conf')).status).toBe('NO_SHOW')
    expect((await getProcess(F, U, ME, 'prc_bkg_seed_pa_conf')).nextStep).toEqual({ code: 'RESCHEDULE', actor: 'FAMILY' })
  })

  it('conta suspensa lê mas não escreve (PROFESSIONAL_LOCKED)', async () => {
    signIn(PA)
    professionalDb.professionals.find((p) => p.id === PA)!.validationStatus = 'SUSPENDED'
    expect((await pb.listProfessionalBookings({})).items.length).toBeGreaterThan(0)
    expect(await code(pb.confirmBooking('bkg_seed_pa_req'))).toBe('PROFESSIONAL_LOCKED')
    expect(await code(pb.replyToReview('rev_pa_2', 'Obrigada'))).toBe('PROFESSIONAL_LOCKED')
  })

  it('um bloqueio sobre uma marcação ativa é recusado (CONFLICT); sem marcações passa', async () => {
    signIn(PA)
    const booking = consultationsDb.bookings.find((b) => b.id === 'bkg_seed_pa_conf')!
    const around = { startsAt: new Date(Date.parse(booking.startsAt) - 1000).toISOString(), endsAt: new Date(Date.parse(booking.endsAt) + 1000).toISOString() }
    expect(await code(portal.createProfessionalTimeOff(around))).toBe('CONFLICT')
    expect(await code(portal.createProfessionalTimeOff({ startsAt: new Date(Date.now() + 30 * DAY).toISOString(), endsAt: new Date(Date.now() + 31 * DAY).toISOString() }))).toBe('OK')
  })
})

// ───── Pagamento ─────

describe('comprovativo de pagamento', () => {
  it('instruções só com a marcação confirmada; carregar, antivírus, decisão do profissional', async () => {
    const f = (id: string) => cs.getFamilyBooking(F, U, PEDRO, id)
    const booking = await book(PA, PA_OFFER, PEDRO)
    expect(await code(cs.uploadPaymentProof(F, U, PEDRO, booking.id, pdf()))).toBe('INVALID_STATE_TRANSITION')
    signIn(PA)
    await pb.confirmBooking(booking.id)
    const proof = await cs.uploadPaymentProof(F, U, PEDRO, booking.id, pdf())
    expect(proof).toMatchObject({ status: 'SUBMITTED', scanStatus: 'PENDING' })
    expect((await f(booking.id)).paymentStatus).toBe('PROOF_SUBMITTED')
    expect(await code(cs.uploadPaymentProof(F, U, PEDRO, booking.id, pdf()))).toBe('CONFLICT')
    // Enquanto o antivírus corre, o profissional ainda não descarrega; depois da leitura, sim.
    expect(await code(pb.downloadProfessionalPaymentProof(booking.id, proof.id))).toBe('OK')
    expect((await cs.listFamilyPaymentProofs(F, U, PEDRO, booking.id))[0]!.scanStatus).toBe('CLEAN')
    expect((await getProcess(F, U, PEDRO, booking.processId!)).nextStep.code).toBe('AWAIT_PAYMENT_CONFIRMATION')
    await pb.decidePaymentProof(booking.id, proof.id, { decision: 'CONFIRM' })
    expect((await f(booking.id)).paymentStatus).toBe('CONFIRMED')
    expect(await code(pb.decidePaymentProof(booking.id, proof.id, { decision: 'CONFIRM' }))).toBe('INVALID_STATE_TRANSITION')
  })

  it('tipo e tamanho do ficheiro; infetado nunca fica descarregável e o pagamento volta a «falta o comprovativo»', async () => {
    signIn(PA)
    expect(await code(cs.uploadPaymentProof(F, U, ME, 'bkg_seed_conf', new File(['x'], 'a.exe', { type: 'application/x-msdownload' })))).toBe('NOT_FOUND')
    const booking = await book(PA, PA_OFFER, PEDRO)
    await pb.confirmBooking(booking.id)
    expect(await code(cs.uploadPaymentProof(F, U, PEDRO, booking.id, new File(['x'], 'a.exe', { type: 'application/x-msdownload' })))).toBe('FILE_TYPE_NOT_ALLOWED')
    expect(await code(cs.uploadPaymentProof(F, U, PEDRO, booking.id, new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'a.pdf', { type: 'application/pdf' })))).toBe('FILE_TOO_LARGE')
    await cs.uploadPaymentProof(F, U, PEDRO, booking.id, pdf('eicar.pdf'))
    expect(await cs.listFamilyPaymentProofs(F, U, PEDRO, booking.id)).toEqual([])
    expect((await cs.getFamilyBooking(F, U, PEDRO, booking.id)).paymentStatus).toBe('AWAITING_PROOF')
  })

  it('rejeição → disputa → decisão do admin (confirmar o pagamento) e a família é avisada pelo estado', async () => {
    const booking = await book(PA, PA_OFFER, PEDRO)
    signIn(PA)
    await pb.confirmBooking(booking.id)
    const proof = await cs.uploadPaymentProof(F, U, PEDRO, booking.id, pdf())
    await cs.listFamilyPaymentProofs(F, U, PEDRO, booking.id)
    expect(await code(pb.decidePaymentProof(booking.id, proof.id, { decision: 'REJECT' }))).toBe('VALIDATION_ERROR')
    await pb.decidePaymentProof(booking.id, proof.id, { decision: 'REJECT', reason: 'Valor incorreto' })
    expect(await code(cs.disputePaymentProof(F, U, PEDRO, booking.id, 'prf_inexistente'))).toBe('NOT_FOUND')
    expect((await cs.getFamilyBooking(F, U, PEDRO, booking.id)).canSendProof).toBe(true)
    expect((await cs.disputePaymentProof(F, U, PEDRO, booking.id, proof.id, 'Paguei o valor certo')).status).toBe('DISPUTED')
    expect(await code(cs.disputePaymentProof(F, U, PEDRO, booking.id, proof.id))).toBe('INVALID_STATE_TRANSITION')

    const queue = await admin.adminListPaymentDisputes()
    expect(queue.items.map((i) => i.proofId)).toContain(proof.id)
    const detail = await admin.adminGetPaymentDispute(proof.id)
    expect(detail.professionalReason).toBe('Valor incorreto')
    expect(detail.familyNote).toBe('Paguei o valor certo')
    const text = JSON.stringify([queue, detail])
    for (const forbidden of ['fam_monarca', 'mem_pedro', 'usr_monarca', 'participantLabel', 'Pedro']) expect(text).not.toContain(forbidden)
    await expect(admin.adminDownloadPaymentProof(proof.id)).resolves.toBeInstanceOf(Blob)
    const decided = await admin.adminDecidePaymentDispute(proof.id, 'CONFIRM_PAYMENT')
    expect(decided).toMatchObject({ status: 'DECIDED', decision: 'CONFIRM_PAYMENT' })
    expect((await cs.getFamilyBooking(F, U, PEDRO, booking.id)).paymentStatus).toBe('CONFIRMED')
    expect(await code(admin.adminDecidePaymentDispute(proof.id, 'CONFIRM_PAYMENT'))).toBe('INVALID_STATE_TRANSITION')
    expect(await code(admin.adminDownloadPaymentProof(proof.id))).toBe('DOCUMENT_NOT_AVAILABLE')
  })

  it('a fila do admin: a disputa de demonstração aparece; manter a recusa deixa o pagamento recusado; marcação cancelada sai da fila', async () => {
    const queue = await admin.adminListPaymentDisputes()
    expect(queue.items.map((i) => i.proofId)).toContain('prf_seed_disp')
    await admin.adminDecidePaymentDispute('prf_seed_disp', 'UPHOLD_REJECTION')
    expect(consultationsDb.bookings.find((b) => b.id === 'bkg_seed_disp')!.paymentStatus).toBe('REJECTED')
    expect((await admin.adminListPaymentDisputes({ status: 'DECIDED' })).items.map((i) => i.proofId)).toContain('prf_seed_disp')

    resetConsultationsDb()
    consultationsDb.bookings.find((b) => b.id === 'bkg_seed_disp')!.status = 'CANCELLED'
    expect((await admin.adminListPaymentDisputes()).items).toEqual([])
    expect(await code(admin.adminGetPaymentDispute('prf_seed_disp'))).toBe('NOT_FOUND')
    expect(await code(admin.adminDownloadPaymentProof('prf_seed_disp'))).toBe('DOCUMENT_NOT_AVAILABLE')
    expect(await code(admin.adminDecidePaymentDispute('prf_seed_disp', 'CONFIRM_PAYMENT'))).toBe('INVALID_STATE_TRANSITION')
  })
})

// ───── Avaliações ─────

describe('avaliações verificadas', () => {
  it('só avalia quem consultou: concluída e paga; cria (nota 1–5, comentário ≤ 500) e edita; processo «pode avaliar» deixa de pedir', async () => {
    expect(await code(cs.putFamilyBookingReview(F, U, ME, 'bkg_seed_req', { rating: 5 }))).toBe('REVIEW_NOT_ALLOWED')
    expect(await code(cs.putFamilyBookingReview(F, U, ME, 'bkg_seed_disp', { rating: 5 }))).toBe('REVIEW_NOT_ALLOWED')
    const before = await cs.getFamilyBooking(F, U, ME, 'bkg_seed_done')
    expect(before).toMatchObject({ canReview: true, hasReview: false })
    expect((await getProcess(F, U, ME, 'prc_bkg_seed_done')).nextStep).toEqual({ code: 'LEAVE_REVIEW', actor: 'FAMILY' })
    expect(await code(cs.putFamilyBookingReview(F, U, ME, 'bkg_seed_done', { rating: 0 }))).toBe('VALIDATION_ERROR')
    expect(await code(cs.putFamilyBookingReview(F, U, ME, 'bkg_seed_done', { rating: 4, comment: 'x'.repeat(501) }))).toBe('VALIDATION_ERROR')

    const created = await cs.putFamilyBookingReview(F, U, ME, 'bkg_seed_done', { rating: 4, comment: 'Boa consulta' })
    expect(created.created).toBe(true)
    expect(created.review.editableUntil).toBeDefined()
    expect((await cs.putFamilyBookingReview(F, U, ME, 'bkg_seed_done', { rating: 5 })).created).toBe(false)
    expect((await getProcess(F, U, ME, 'prc_bkg_seed_done')).nextStep.code).toBe('NOTHING_PENDING')
    // Passados 7 dias já não se edita.
    consultationsDb.reviews.find((r) => r.bookingId === 'bkg_seed_done')!.createdAt = new Date(Date.now() - 8 * DAY).toISOString()
    expect(await code(cs.putFamilyBookingReview(F, U, ME, 'bkg_seed_done', { rating: 1 }))).toBe('REVIEW_NOT_ALLOWED')
  })

  it('passados 30 dias já não se avalia', async () => {
    consultationsDb.bookings.find((b) => b.id === 'bkg_seed_done')!.completedAt = new Date(Date.now() - 31 * DAY).toISOString()
    expect(await code(cs.putFamilyBookingReview(F, U, ME, 'bkg_seed_done', { rating: 5 }))).toBe('REVIEW_NOT_ALLOWED')
  })

  it('a lista pública é anónima, tem resumo (média só com 3+), esconde o comentário moderado e traz a resposta', async () => {
    const page = await cs.listProfessionalReviews(PSICO1)
    expect(page.summary).toEqual({ count: 4, averageRating: 4.8 })
    const text = JSON.stringify(page)
    for (const forbidden of ['bookingId', 'participantLabel', 'fam_monarca', 'mem_monarca', 'professionalId']) expect(text).not.toContain(forbidden)
    const hidden = page.items.find((r) => r.commentHidden)!
    expect(hidden.comment).toBeUndefined()
    expect(page.items.find((r) => r.reply)?.reply?.text).toBeDefined()
    const createdOn = page.items.map((r) => r.createdOn)
    expect(createdOn).toEqual([...createdOn].sort().reverse())
    expect((await cs.listProfessionalReviews('pro_pub_nutri1')).summary).toEqual({ count: 1 })
    expect(await code(cs.listProfessionalReviews('pro_fila'))).toBe('NOT_FOUND')
  })

  it('uma avaliação nova entra no resumo; o ranking v2 sobe com notas altas (RATED só com 3+)', async () => {
    const before = (await marketplace.searchProfessionals({ specialtyId: 'spc_nutri' })).items[0]!
    expect(before.ranking?.label).toBe('NEW')
    await cs.putFamilyBookingReview(F, U, ME, 'bkg_seed_done', { rating: 5 })
    expect((await marketplace.getMarketplaceProfessional('pro_pub_psico3', 'spc_psico')).reviewSummary).toEqual({ count: 4, averageRating: 4.5 })
  })

  it('o profissional responde uma vez e denuncia; denunciar duas vezes devolve a existente', async () => {
    signIn(PA)
    const page = await pb.listProfessionalReviewsOwn({ unanswered: true })
    expect(page.items.map((r) => r.id)).toEqual(['rev_pa_2'])
    expect((await pb.replyToReview('rev_pa_2', 'Obrigada!')).reply?.text).toBe('Obrigada!')
    expect(await code(pb.replyToReview('rev_pa_2', 'Outra vez'))).toBe('CONFLICT')
    expect(await code(pb.replyToReview('rev_p1_1', 'x'))).toBe('NOT_FOUND')
    const report = await pb.reportReview('rev_pa_2', { reason: 'OFF_TOPIC', note: 'Fala da sala' })
    expect((await pb.reportReview('rev_pa_2', { reason: 'ABUSE' })).id).toBe(report.id)
    expect((await pb.listProfessionalReviewsOwn()).items.find((r) => r.id === 'rev_pa_2')?.reported).toBe(true)
  })

  it('o admin vê o texto original, oculta só o comentário (a nota conta) e não vê família nem marcação', async () => {
    const queue = await admin.adminListReviewReports()
    expect(queue.items.map((i) => i.id)).toContain('rrp_seed_1')
    const detail = await admin.adminGetReviewReport('rrp_seed_1')
    expect(detail.review.comment).toBeDefined()
    const text = JSON.stringify([queue, detail])
    for (const forbidden of ['bookingId', 'fam_monarca', 'mem_monarca', 'participantLabel']) expect(text).not.toContain(forbidden)
    const decided = await admin.adminDecideReviewReport('rrp_seed_1', 'HIDE_COMMENT')
    expect(decided).toMatchObject({ status: 'DECIDED', decision: 'HIDE_COMMENT' })
    expect(decided.review.commentHidden).toBe(true)
    const reviews = await cs.listProfessionalReviews(PSICO1)
    expect(reviews.summary.count).toBe(4)
    expect(reviews.items.filter((r) => r.commentHidden)).toHaveLength(2)
    expect(await code(admin.adminDecideReviewReport('rrp_seed_1', 'DISMISS'))).toBe('INVALID_STATE_TRANSITION')
  })
})
