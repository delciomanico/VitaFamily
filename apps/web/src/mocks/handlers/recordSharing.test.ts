import { beforeEach, describe, expect, it } from 'vitest'
import { professionalSessionStore } from '@/lib/storage'
import { db, resetDb } from '../db'
import { consultationsDb, resetConsultationsDb } from '../consultationsDb'
import { resetMarketplaceDb } from '../marketplaceDb'
import { resetProfessionalDb } from '../professionalDb'
import { recordSharingDb, resetRecordSharingDb, setDigitalPrescriptionEnabled } from '../recordSharingDb'
import * as cs from './consultations'
import * as medications from './medications'
import * as pb from './professionalBookings'
import * as rx from './professionalPrescriptions'
import * as rs from './recordSharing'
import type { ProfessionalPrescriptionInput } from '@/types/recordSharing'

const F = 'fam_monarca'
const U = 'usr_monarca'
const ME = 'mem_monarca'
const PEDRO = 'mem_pedro'
const PA = 'pro_aprovada'
const DONE = 'bkg_seed_pa_done'
const CONF = 'bkg_seed_pa_conf'
const DAY = 86_400_000

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: { code: string }) => e.code,
  )
const signIn = (id: string | null) => (id ? professionalSessionStore.setAccountId(id) : window.sessionStorage.clear())
const bookingOf = (id: string) => consultationsDb.bookings.find((b) => b.id === id)!
/** Torna a marcação de demonstração numa de profissional de saúde (a de `pro_aprovada` é de bem-estar). */
const makeHealth = (id: string) => {
  bookingOf(id).offer.category = 'HEALTH'
}

const prescription = (name = 'Paracetamol'): ProfessionalPrescriptionInput => ({
  notes: 'Tomar com água.',
  medications: [{ name, dosage: '500 mg', scheduleType: 'FIXED_TIMES', times: ['08:00', '20:00'], startAt: new Date().toISOString(), endAt: new Date(Date.now() + 5 * DAY).toISOString(), continuous: false, notes: 'Depois das refeições' }],
})

beforeEach(() => {
  resetDb()
  resetMarketplaceDb()
  resetProfessionalDb()
  resetConsultationsDb()
  resetRecordSharingDb()
  window.sessionStorage.clear()
})

describe('família: opções e criar', () => {
  it('bem-estar só permite medicação; saúde permite as cinco categorias', async () => {
    const wellness = await rs.getRecordShareOptions(F, U, ME, DONE)
    expect(wellness.allowedCategories).toEqual(['MEDICATION'])
    expect(wellness.viewOnceAllowed).toBe(true)
    expect(wellness.maxActive).toBe(20)
    expect(wellness.activeCount).toBe(2)
    expect(wellness.validities.map((v) => v.validity)).toEqual(['H24', 'D7', 'D30', 'UNTIL_CONSULTATION_END_PLUS_24H'])
    makeHealth(DONE)
    expect((await rs.getRecordShareOptions(F, U, ME, DONE)).allowedCategories).toHaveLength(5)
  })

  it('a opção «fim da consulta + 24 h» não é elegível se já passou', async () => {
    const booking = bookingOf(DONE)
    booking.endsAt = new Date(Date.now() - 3 * DAY).toISOString()
    const options = await rs.getRecordShareOptions(F, U, ME, DONE)
    expect(options.validities.find((v) => v.validity === 'UNTIL_CONSULTATION_END_PLUS_24H')?.eligible).toBe(false)
    expect(await code(rs.createRecordShare(F, U, ME, { bookingId: DONE, categories: ['MEDICATION'], validity: 'UNTIL_CONSULTATION_END_PLUS_24H' }))).toBe('VALIDATION_ERROR')
  })

  it('marcação por confirmar, alheia ou de outro membro não se partilha; DEPENDENT_SELF/OTHER ⇒ FORBIDDEN', async () => {
    expect(await code(rs.getRecordShareOptions(F, U, ME, 'bkg_seed_conf'))).toBe('NOT_FOUND') // marcação de outro membro
    expect(await code(rs.getRecordShareOptions(F, U, ME, 'bkg_seed_req'))).toBe('INVALID_STATE_TRANSITION') // ainda por responder
    expect(await code(rs.getRecordShareOptions(F, U, PEDRO, 'bkg_seed_conf'))).toBe('OK')
    expect(await code(rs.getRecordShareOptions(F, U, ME, 'bkg_seed_nao_existe'))).toBe('NOT_FOUND')
    expect(await code(rs.getRecordShareOptions(F, 'usr_ana', ME, DONE))).toBe('FORBIDDEN')
    const requested = bookingOf(CONF)
    requested.status = 'REQUESTED'
    expect(await code(rs.getRecordShareOptions(F, U, ME, CONF))).toBe('INVALID_STATE_TRANSITION')
  })

  it('cria com prazo calculado pelo servidor, lista, vê e é idempotente por clientRequestId', async () => {
    const clientRequestId = crypto.randomUUID()
    const share = await rs.createRecordShare(F, U, ME, { bookingId: CONF, categories: ['MEDICATION'], validity: 'D7', viewOnce: true, clientRequestId })
    expect(share.status).toBe('ACTIVE')
    expect(share.viewOnce).toBe(true)
    expect(Date.parse(share.expiresAt) - Date.now()).toBeGreaterThan(6.9 * DAY)
    expect(share.viewCount).toBe(0)
    const again = await rs.createRecordShare(F, U, ME, { bookingId: CONF, categories: ['MEDICATION'], validity: 'D7', clientRequestId })
    expect(again.id).toBe(share.id)
    expect(await code(rs.createRecordShare(F, U, ME, { bookingId: DONE, categories: ['MEDICATION'], validity: 'D7', clientRequestId }))).toBe('CONFLICT')
    const list = await rs.listRecordShares(F, U, ME, { bookingId: CONF })
    expect(list.items.map((s) => s.id)).toContain(share.id)
    expect((await rs.getRecordShare(F, U, ME, share.id)).id).toBe(share.id)
    expect(await code(rs.getRecordShare(F, U, PEDRO, share.id))).toBe('NOT_FOUND')
  })

  it('valida categorias (vazias, repetidas, fora do permitido) e o limite de 20 ativas', async () => {
    const make = (categories: Array<'MEDICATION' | 'EXAMS'>) => rs.createRecordShare(F, U, ME, { bookingId: DONE, categories, validity: 'H24' })
    expect(await code(make([]))).toBe('VALIDATION_ERROR')
    expect(await code(make(['MEDICATION', 'MEDICATION']))).toBe('VALIDATION_ERROR')
    expect(await code(make(['EXAMS']))).toBe('VALIDATION_ERROR')
    for (let i = 0; i < 18; i += 1) await make(['MEDICATION'])
    expect(await code(make(['MEDICATION']))).toBe('LIMIT_EXCEEDED')
  })

  it('revogar: efeito imediato, só uma vez, e as vistas ficam', async () => {
    expect((await rs.listRecordShareViews(F, U, ME, 'shr_seed_active')).items).toHaveLength(1)
    const revoked = await rs.revokeRecordShare(F, U, ME, 'shr_seed_active')
    expect(revoked.status).toBe('REVOKED')
    expect(await code(rs.revokeRecordShare(F, U, ME, 'shr_seed_active'))).toBe('INVALID_STATE_TRANSITION')
    expect((await rs.listRecordShareViews(F, U, ME, 'shr_seed_active')).items).toHaveLength(1)
    signIn(PA)
    expect(await code(rs.openProfessionalShare('shr_seed_active'))).toBe('SHARE_NOT_AVAILABLE')
  })

  it('«Quem viu» devolve o nome público, as categorias e a data; nunca o conteúdo', async () => {
    const { items } = await rs.listRecordShareViews(F, U, ME, 'shr_seed_active')
    expect(items[0]).toMatchObject({ viewNo: 1, professionalName: 'Marta Lopes', categories: ['MEDICATION'] })
    expect(Object.keys(items[0]!).sort()).toEqual(['categories', 'professionalName', 'viewNo', 'viewedAt'])
  })
})

describe('profissional: partilhas recebidas e abrir', () => {
  it('lista e detalhe só com o rótulo e metadados: nunca ids de família, membro ou utilizador', async () => {
    signIn(PA)
    const page = await rs.listProfessionalShares()
    expect(page.items.length).toBe(3)
    const text = JSON.stringify(page)
    expect(text).not.toMatch(/fam_monarca|mem_monarca|usr_monarca|familyId|memberId|userId|birth/)
    const detail = await rs.getProfessionalShare('shr_seed_active')
    expect(detail).toMatchObject({ participantLabel: 'Monarca', openCount: 1, canOpen: true })
  })

  it('outro profissional ou conta de família: NOT_FOUND idêntico / sem sessão', async () => {
    signIn('pro_suspensa')
    expect(await code(rs.getProfessionalShare('shr_seed_active'))).toBe('NOT_FOUND')
    expect(await code(rs.openProfessionalShare('shr_seed_active'))).toBe('NOT_FOUND')
    expect(await code(rs.getProfessionalShare('inexistente'))).toBe('NOT_FOUND')
    signIn(null)
    expect(await code(rs.listProfessionalShares())).toBe('INVALID_CREDENTIALS')
  })

  it('abrir devolve só as categorias concedidas, a idade, a marca de água e regista a vista', async () => {
    signIn(PA)
    const view = await rs.openProfessionalShare('shr_seed_active')
    expect(view.participantLabel).toBe('Monarca')
    expect(view.ageYears).toBeGreaterThan(30)
    expect(view.watermark.professionalName).toBe('Marta Lopes')
    expect(view.watermark.openedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Array.isArray(view.medications)).toBe(true)
    expect(view.allergies).toBeUndefined()
    expect(view.conditions).toBeUndefined()
    expect(view.examinations).toBeUndefined()
    expect(JSON.stringify(view)).not.toMatch(/birthDate|1985|memberId|familyId/)
    expect(view.medications!.length).toBeGreaterThan(0)
    expect((await rs.getProfessionalShare('shr_seed_active')).openCount).toBe(2)
    // A família vê as duas aberturas, a mais recente primeiro.
    const views = await rs.listRecordShareViews(F, U, ME, 'shr_seed_active')
    expect(views.items.map((v) => v.viewNo)).toEqual([2, 1])
  })

  it('com todas as categorias lê alergias e tipo de sangue, condições, consultas e exames', async () => {
    makeHealth(DONE)
    const share = await rs.createRecordShare(F, U, ME, { bookingId: DONE, categories: ['ALLERGIES', 'CONDITIONS', 'MEDICATION', 'APPOINTMENTS', 'EXAMS'], validity: 'H24' })
    signIn(PA)
    const view = await rs.openProfessionalShare(share.id)
    expect(view.allergies?.map((a) => a.name)).toContain('Pólen')
    expect(view.bloodType).toBe('O_POS')
    expect(view.conditions?.length).toBeGreaterThan(0)
    expect(view.appointments).toBeDefined()
    expect(view.examinations?.length).toBeGreaterThan(0)
    // Sem notas nem texto livre dos registos.
    expect(JSON.stringify(view)).not.toContain('Cirurgia sem complicações')
  })

  it('visualização única: abre uma vez; a segunda dá SHARE_ALREADY_VIEWED e a família vê «consumida»', async () => {
    signIn(PA)
    expect((await rs.openProfessionalShare('shr_seed_once')).viewOnce).toBe(true)
    expect(await code(rs.openProfessionalShare('shr_seed_once'))).toBe('SHARE_ALREADY_VIEWED')
    expect((await rs.getRecordShare(F, U, ME, 'shr_seed_once')).status).toBe('CONSUMED')
    expect((await rs.getProfessionalShare('shr_seed_once')).canOpen).toBe(false)
    expect(await code(rs.revokeRecordShare(F, U, ME, 'shr_seed_once'))).toBe('INVALID_STATE_TRANSITION')
  })

  it('expirada, revogada, marcação cancelada ou profissional não aprovado: todas SHARE_NOT_AVAILABLE, sem vista', async () => {
    signIn(PA)
    const views = () => recordSharingDb.views.length
    const before = views()
    expect(await code(rs.openProfessionalShare('shr_seed_revoked'))).toBe('SHARE_NOT_AVAILABLE')
    recordSharingDb.shares.find((s) => s.id === 'shr_seed_active')!.expiresAt = new Date(Date.now() - 1000).toISOString()
    expect(await code(rs.openProfessionalShare('shr_seed_active'))).toBe('SHARE_NOT_AVAILABLE')
    expect((await rs.getRecordShare(F, U, ME, 'shr_seed_active')).status).toBe('EXPIRED')
    bookingOf(CONF).status = 'CANCELLED'
    expect(await code(rs.openProfessionalShare('shr_seed_once'))).toBe('SHARE_NOT_AVAILABLE')
    bookingOf(CONF).status = 'CONFIRMED'
    resetProfessionalDbSuspended()
    expect(await code(rs.openProfessionalShare('shr_seed_once'))).toBe('SHARE_NOT_AVAILABLE')
    // Ler a lista continua permitido a profissional suspenso.
    expect(await code(rs.listProfessionalShares())).toBe('OK')
    expect(views()).toBe(before)
  })

  it('membro bloqueado não se abre', async () => {
    db.members.find((m) => m.id === ME)!.status = 'BLOCKED'
    signIn(PA)
    expect(await code(rs.openProfessionalShare('shr_seed_active'))).toBe('SHARE_NOT_AVAILABLE')
  })
})

async function resetProfessionalDbSuspended() {
  const { professionalDb } = await import('../professionalDb')
  professionalDb.professionals.find((p) => p.id === PA)!.validationStatus = 'SUSPENDED'
}

describe('receita digital (atrás da flag)', () => {
  it('desligada: emitir e ler dão 404; canPrescribe e prescriptionId omitidos', async () => {
    makeHealth(DONE)
    signIn(PA)
    expect(await code(rx.issueProfessionalPrescription(DONE, prescription()))).toBe('NOT_FOUND')
    expect(await code(rx.getProfessionalBookingPrescription(DONE))).toBe('NOT_FOUND')
    const booking = await pb.getProfessionalBooking(DONE)
    expect(booking.canPrescribe).toBeUndefined()
    expect(booking.hasPrescription).toBeUndefined()
    expect((await cs.getFamilyBooking(F, U, ME, DONE)).prescriptionId).toBeUndefined()
  })

  describe('ligada', () => {
    beforeEach(() => {
      setDigitalPrescriptionEnabled(true)
      makeHealth(DONE)
      signIn(PA)
    })

    it('emite no registo do membro, com origem, data e nome fixados pelo servidor, e o profissional relê-a', async () => {
      expect((await pb.getProfessionalBooking(DONE)).canPrescribe).toBe(true)
      const issued = await rx.issueProfessionalPrescription(DONE, prescription())
      expect(issued.issuedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Object.keys(issued).sort()).toEqual(['bookingId', 'createdAt', 'issuedOn', 'medications', 'notes'])
      const created = db.prescriptions.find((p) => p.bookingId === DONE)!
      expect(created).toMatchObject({ issuedBy: 'PROFESSIONAL', memberId: ME, doctorName: 'Marta Lopes', status: 'ACTIVE' })
      expect(db.medicationPlans.filter((p) => p.prescriptionId === created.id)).toHaveLength(1)
      expect((await rx.getProfessionalBookingPrescription(DONE)).medications[0]?.name).toBe('Paracetamol')
      const after = await pb.getProfessionalBooking(DONE)
      expect(after).toMatchObject({ canPrescribe: false, hasPrescription: true })
      expect((await cs.getFamilyBooking(F, U, ME, DONE)).prescriptionId).toBe(created.id)
      expect(await code(rx.issueProfessionalPrescription(DONE, prescription()))).toBe('CONFLICT')
    })

    it('regras: bem-estar ⇒ FORBIDDEN; não concluída ou fora dos 7 dias ⇒ INVALID_STATE_TRANSITION; não aprovado ⇒ LOCKED; corpo inválido ⇒ VALIDATION_ERROR', async () => {
      bookingOf(DONE).offer.category = 'WELLNESS'
      expect(await code(rx.issueProfessionalPrescription(DONE, prescription()))).toBe('FORBIDDEN')
      makeHealth(DONE)
      bookingOf(DONE).completedAt = new Date(Date.now() - 8 * DAY).toISOString()
      expect(await code(rx.issueProfessionalPrescription(DONE, prescription()))).toBe('INVALID_STATE_TRANSITION')
      expect((await pb.getProfessionalBooking(DONE)).canPrescribe).toBe(false)
      bookingOf(DONE).completedAt = new Date().toISOString()
      makeHealth(CONF)
      expect(await code(rx.issueProfessionalPrescription(CONF, prescription()))).toBe('INVALID_STATE_TRANSITION')
      expect(await code(rx.issueProfessionalPrescription(DONE, { medications: [] }))).toBe('VALIDATION_ERROR')
      expect(await code(rx.issueProfessionalPrescription(DONE, { notes: 'x'.repeat(501), medications: prescription().medications }))).toBe('VALIDATION_ERROR')
      await resetProfessionalDbSuspended()
      expect(await code(rx.issueProfessionalPrescription(DONE, prescription()))).toBe('PROFESSIONAL_LOCKED')
    })

    it('marcação de outro profissional ⇒ 404 idêntico; se a família apagar a receita, o profissional já não a lê', async () => {
      signIn('pro_suspensa')
      expect(await code(rx.issueProfessionalPrescription(DONE, prescription()))).toBe('NOT_FOUND')
      signIn(PA)
      await rx.issueProfessionalPrescription(DONE, prescription())
      db.prescriptions = db.prescriptions.filter((p) => p.bookingId !== DONE)
      expect(await code(rx.getProfessionalBookingPrescription(DONE))).toBe('NOT_FOUND')
      expect((await cs.getFamilyBooking(F, U, ME, DONE)).prescriptionId).toBeUndefined()
    })

    it('a família só lê o conteúdo: editar medicamento ⇒ CONFLICT; ajustar horários, concluir e cancelar são permitidos', async () => {
      await rx.issueProfessionalPrescription(DONE, prescription())
      const rxRow = db.prescriptions.find((p) => p.bookingId === DONE)!
      const plan = db.medicationPlans.find((p) => p.prescriptionId === rxRow.id)!
      const content = { name: 'Outro', dosage: '1 g', scheduleType: 'FIXED_TIMES' as const, times: ['09:00'], continuous: false, endDate: '2099-01-01' }
      expect(await code(medications.updateMedication(F, U, plan.id, content))).toBe('CONFLICT')
      expect(plan.name).toBe('Paracetamol')
      await medications.updateMedication(F, U, plan.id, { ...content, scheduleOnly: true })
      expect(plan.times).toEqual(['09:00'])
      expect(plan.name).toBe('Paracetamol')
      expect((await medications.getMedication(F, U, plan.id)).prescription?.issuedBy).toBe('PROFESSIONAL')
      expect((await medications.setPrescriptionStatus(F, U, rxRow.id, 'CANCELLED')).status).toBe('CANCELLED')
    })
  })
})
