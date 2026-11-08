import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import { db, resetDb } from '../db'
import { at } from '../time'
import * as insurance from './insurance'
import * as insurancePortal from './insurancePortal'
import * as clinicDay from './clinicDay'
import * as patients from './clinicPatients'
import * as portal from './clinicPortal'
import * as receipts from './clinicReceipts'
import * as clinics from './clinics'

const ADMIN = 'cac_horizonte_admin'
const MANAGER = 'cac_horizonte_rececao'
const DOCTOR = 'cac_horizonte_medica'
const OTHER = 'cac_vidaplena_admin'
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const NOW = new Date(2026, 10, 5, 12, 0)

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

let seq = 0
/** Consulta Vita concluída da Clínica Horizonte (por omissão: membro Maria, serviço de cardiologia da Dr.ª Ana). */
function completed(patch: Partial<Appointment> = {}): Appointment {
  seq += 1
  db.slots.push({
    id: `slot_rcp_${seq}`,
    clinicId: 'cln_horizonte',
    kind: 'APPOINTMENT',
    capacity: 1,
    specialty: 'Consulta de cardiologia',
    professionalId: 'pro_ana',
    professionalName: 'Dr.ª Ana Costa',
    serviceTypeId: 'svc_cardio',
    startsAt: at(-1, '10:00', NOW),
    durationMinutes: 30,
  })
  const appointment: Appointment = {
    id: `apt_rcp_${seq}`,
    familyId: FAMILY,
    memberId: 'mem_maria',
    scheduledAt: at(-1, '10:00', NOW),
    status: 'COMPLETED',
    slotId: `slot_rcp_${seq}`,
    specialty: 'Consulta de cardiologia',
    clinicId: 'cln_horizonte',
    clinicName: 'Clínica Horizonte',
    ...patch,
  }
  db.appointments.push(appointment)
  return appointment
}

const issue = (id: string, extra: Record<string, unknown> = {}, account = MANAGER) =>
  receipts.issueClinicReceipt(account, { bookingKind: 'APPOINTMENT', bookingId: id, paymentMethod: 'CASH', ...extra }, NOW)

beforeEach(() => {
  resetDb(NOW)
  seq = 0
  db.clinicAccounts.push({
    id: OTHER,
    clinicId: 'cln_vidaplena',
    email: 'admin@vidaplena.pt',
    password: 'x',
    role: 'CLINIC_ADMIN',
    status: 'ACTIVE',
  })
})

describe('emitir recibo (BR-CLN-31/32/34)', () => {
  it('um toque: sem linhas usa o serviço do horário, com o preço do catálogo', async () => {
    const a = completed()
    const receipt = await issue(a.id)
    expect(receipt).toMatchObject({
      number: 1,
      status: 'ISSUED',
      bookingKind: 'APPOINTMENT',
      currency: 'AOA',
      totalMinor: 1_500_000,
      patientName: 'Maria Lopes',
    })
    expect(receipt.lines).toEqual([
      { position: 1, description: 'Consulta de cardiologia', amountMinor: 1_500_000, serviceTypeId: 'svc_cardio' },
    ])
    expect(receipt.notice).toContain('Documento não fiscal')
    expect(receipt.issuer.name).toBe('Clínica Horizonte')
  })

  it('numeração sequencial por clínica, sem buracos, mesmo com erros pelo meio', async () => {
    const [a, b, c] = [completed(), completed(), completed()]
    expect((await issue(a!.id)).number).toBe(1)
    // Falhas de validação não consomem número.
    expect(await code(issue(b!.id, { lines: [{ description: 'Livre', amountMinor: 0 }] }))).toBe('VALIDATION_ERROR')
    expect(await code(issue('apt_inexistente'))).toBe('NOT_FOUND')
    expect((await issue(b!.id)).number).toBe(2)
    expect((await issue(c!.id)).number).toBe(3)
    // Cada clínica tem a sua sequência.
    db.slots.push({
      id: 'slot_vp',
      clinicId: 'cln_vidaplena',
      kind: 'APPOINTMENT',
      capacity: 1,
      specialty: 'X',
      startsAt: at(-1, '09:00', NOW),
      durationMinutes: 30,
    })
    db.services.push({
      id: 'svc_vp',
      clinicId: 'cln_vidaplena',
      name: 'Consulta',
      kind: 'APPOINTMENT',
      durationMinutes: 30,
      priceMinor: 500,
      currency: 'AOA',
      active: true,
    })
    const other = completed({ clinicId: 'cln_vidaplena', slotId: 'slot_vp' })
    expect(
      (await receipts.issueClinicReceipt(OTHER, { bookingKind: 'APPOINTMENT', bookingId: other.id, paymentMethod: 'CARD', lines: [{ serviceTypeId: 'svc_vp' }] }, NOW))
        .number,
    ).toBe(1)
  })

  it('um recibo ISSUED por marcação; depois de anulado pode emitir-se outro (número novo)', async () => {
    const a = completed()
    const first = await issue(a.id)
    expect(await code(issue(a.id))).toBe('CONFLICT')
    await receipts.voidClinicReceipt(MANAGER, first.id, 'Valor errado', NOW)
    const second = await issue(a.id, { lines: [{ serviceTypeId: 'svc_cardio', amountMinor: 1_000_000 }] })
    expect(second.number).toBe(2)
    expect(second.totalMinor).toBe(1_000_000)
  })

  it('só marcações concluídas da própria clínica', async () => {
    const scheduled = completed({ status: 'SCHEDULED' })
    expect(await code(issue(scheduled.id))).toBe('CONFLICT')
    const a = completed()
    expect(await code(receipts.issueClinicReceipt(OTHER, { bookingKind: 'APPOINTMENT', bookingId: a.id, paymentMethod: 'CASH' }, NOW))).toBe(
      'NOT_FOUND',
    )
  })

  it('linhas: catálogo ajustado, linha livre, total > 0 e sem preço ⇒ VALIDATION_ERROR', async () => {
    const a = completed()
    const receipt = await issue(a.id, {
      lines: [{ serviceTypeId: 'svc_cardio', amountMinor: 1_200_000 }, { description: ' Material ', amountMinor: 50_000 }],
      note: ' obrigado ',
    })
    expect(receipt.totalMinor).toBe(1_250_000)
    expect(receipt.lines[1]).toMatchObject({ description: 'Material', serviceTypeId: null })
    expect(receipt.note).toBe('obrigado')

    const b = completed()
    // Serviço sem preço no catálogo (ecografia).
    expect(await code(issue(b.id, { lines: [{ serviceTypeId: 'svc_eco' }] }))).toBe('VALIDATION_ERROR')
    // Sem linhas e horário sem serviço.
    const c = completed({ slotId: undefined })
    expect(await code(issue(c.id))).toBe('VALIDATION_ERROR')
    // Valor não inteiro / acima do limite.
    expect(await code(issue(b.id, { lines: [{ description: 'x', amountMinor: 1.5 }] }))).toBe('VALIDATION_ERROR')
    expect(await code(issue(b.id, { lines: [{ description: 'x', amountMinor: 10 ** 11 + 1 }] }))).toBe('VALIDATION_ERROR')
    expect(await code(issue(b.id, { paymentMethod: 'BITCOIN' }))).toBe('VALIDATION_ERROR')
  })

  it('o Médico não emite nem vê recibos (FORBIDDEN)', async () => {
    const a = completed()
    expect(await code(issue(a.id, {}, DOCTOR))).toBe('FORBIDDEN')
    expect(await code(receipts.listClinicReceipts(DOCTOR, { from: '2026-11-01', to: '2026-11-30' }))).toBe('FORBIDDEN')
    const r = await issue(a.id)
    expect(await code(receipts.getClinicReceipt(DOCTOR, r.id))).toBe('FORBIDDEN')
    expect(await code(receipts.voidClinicReceipt(DOCTOR, r.id, 'motivo', NOW))).toBe('FORBIDDEN')
  })
})

describe('imutabilidade e anulação (BR-CLN-33)', () => {
  it('anular guarda o motivo só na clínica, mantém o número e é irreversível', async () => {
    const a = completed()
    const r = await issue(a.id)
    expect(await code(receipts.voidClinicReceipt(MANAGER, r.id, 'ab', NOW))).toBe('VALIDATION_ERROR')
    const voided = await receipts.voidClinicReceipt(MANAGER, r.id, ' Valor errado ', NOW)
    expect(voided).toMatchObject({ status: 'VOIDED', number: 1, voidReason: 'Valor errado', totalMinor: r.totalMinor })
    expect(voided.lines).toEqual(r.lines)
    expect(await code(receipts.voidClinicReceipt(MANAGER, r.id, 'outra vez', NOW))).toBe('CONFLICT')
    expect((await receipts.getClinicReceipt(MANAGER, r.id)).status).toBe('VOIDED')
  })

  it('o recibo de outra clínica responde NOT_FOUND', async () => {
    const r = await issue(completed().id)
    expect(await code(receipts.getClinicReceipt(OTHER, r.id))).toBe('NOT_FOUND')
    expect(await code(receipts.voidClinicReceipt(OTHER, r.id, 'motivo', NOW))).toBe('NOT_FOUND')
    expect((await receipts.listClinicReceipts(OTHER, { from: '2026-01-01', to: '2026-12-31' })).items).toHaveLength(0)
  })

  it('a marcação mostra o receiptId do recibo ISSUED (e deixa de mostrar depois de anulado)', async () => {
    const a = completed()
    const r = await issue(a.id)
    expect((await portal.listClinicAgenda(MANAGER, NOW)).find((b) => b.id === a.id)?.receiptId).toBe(r.id)
    await receipts.voidClinicReceipt(MANAGER, r.id, 'motivo', NOW)
    expect((await portal.listClinicAgenda(MANAGER, NOW)).find((b) => b.id === a.id)?.receiptId).toBeUndefined()
  })
})

describe('Financeiro: período e total (BR-CLN-37)', () => {
  it('o total do período não soma anulados; lista por issuedAt decrescente', async () => {
    const [a, b, c] = [completed(), completed(), completed()]
    const r1 = await receipts.issueClinicReceipt(MANAGER, { bookingKind: 'APPOINTMENT', bookingId: a!.id, paymentMethod: 'CASH' }, new Date(2026, 10, 3, 9))
    await receipts.issueClinicReceipt(MANAGER, { bookingKind: 'APPOINTMENT', bookingId: b!.id, paymentMethod: 'CARD' }, new Date(2026, 10, 4, 9))
    const r3 = await receipts.issueClinicReceipt(MANAGER, { bookingKind: 'APPOINTMENT', bookingId: c!.id, paymentMethod: 'CASH' }, new Date(2026, 10, 5, 9))
    await receipts.voidClinicReceipt(MANAGER, r1.id, 'Duplicado', NOW)

    const page = await receipts.listClinicReceipts(MANAGER, { from: '2026-11-01', to: '2026-11-30', limit: 1 })
    expect(page.items.map((r) => r.id)).toEqual([r3.id])
    expect(page.nextCursor).toBe('1')
    // O resumo cobre o período inteiro, não só a página.
    expect(page.summary).toEqual({ issuedCount: 2, issuedTotalMinor: 3_000_000, voidedCount: 1, currency: 'AOA' })

    const voidedOnly = await receipts.listClinicReceipts(MANAGER, { from: '2026-11-01', to: '2026-11-30', status: 'VOIDED' })
    expect(voidedOnly.items.map((r) => r.id)).toEqual([r1.id])
    const narrow = await receipts.listClinicReceipts(MANAGER, { from: '2026-11-05', to: '2026-11-05' })
    expect(narrow.summary).toMatchObject({ issuedCount: 1, issuedTotalMinor: 1_500_000, voidedCount: 0 })
  })

  it('janela inválida ou acima de 366 dias ⇒ VALIDATION_ERROR', async () => {
    expect(await code(receipts.listClinicReceipts(MANAGER, { from: '2026-11-05', to: '2026-11-01' }))).toBe('VALIDATION_ERROR')
    expect(await code(receipts.listClinicReceipts(MANAGER, { from: '2025-01-01', to: '2026-11-01' }))).toBe('VALIDATION_ERROR')
    expect(await code(receipts.listClinicReceipts(MANAGER, { from: '', to: '2026-11-01' }))).toBe('VALIDATION_ERROR')
  })
})

describe('consentimento na emissão e recibos do paciente (BR-CLN-35)', () => {
  it('só há ligação ao paciente com consentimento na emissão; a ligação sobrevive à revogação', async () => {
    const without = completed({ memberId: 'mem_maria' })
    expect((await issue(without.id)).availableToPatient).toBe(false)
    expect((await receipts.listFamilyClinicReceipts(FAMILY, MONARCA, 'mem_maria')).items).toHaveLength(0)

    db.clinicConsents.push({ memberId: 'mem_pedro', clinicId: 'cln_horizonte', level: 'BOOKINGS' })
    const consented = completed({ memberId: 'mem_pedro' })
    const r = await issue(consented.id)
    expect(r.availableToPatient).toBe(true)
    // Revogar depois não retira o comprovativo já recebido.
    db.clinicConsents = db.clinicConsents.filter((c) => c.memberId !== 'mem_pedro')
    const list = await receipts.listFamilyClinicReceipts(FAMILY, MONARCA, 'mem_pedro')
    expect(list.items).toHaveLength(1)
    // Cópia do paciente: sem motivo da anulação nem ids da clínica.
    await receipts.voidClinicReceipt(MANAGER, r.id, 'motivo interno', NOW)
    const copy = await receipts.getFamilyClinicReceipt(FAMILY, MONARCA, 'mem_pedro', r.id)
    expect(copy.status).toBe('VOIDED')
    expect(JSON.stringify(copy)).not.toContain('motivo interno')
    expect(Object.keys(copy)).not.toContain('voidReason')
    expect(Object.keys(copy)).not.toContain('issuedByClinicAccountId')
    expect(copy.clinicName).toBe('Clínica Horizonte')
  })

  it('visita manual: só a clínica (sem ligação)', async () => {
    const visit = db.clinicVisits[0]!
    visit.status = 'COMPLETED'
    visit.clinicId = 'cln_horizonte'
    visit.slotId = undefined
    const r = await receipts.issueClinicReceipt(
      MANAGER,
      { bookingKind: 'VISIT', bookingId: visit.id, paymentMethod: 'CASH', lines: [{ description: 'Consulta', amountMinor: 10_000 }] },
      NOW,
    )
    expect(r.availableToPatient).toBe(false)
    expect(db.clinicReceipts.find((x) => x.id === r.id)?.link).toBeNull()
  })

  it('só o titular/tutor vê; OTHER ⇒ FORBIDDEN; outro membro/recibo ⇒ NOT_FOUND', async () => {
    db.clinicConsents.push({ memberId: 'mem_maria', clinicId: 'cln_horizonte', level: 'BOOKINGS' })
    const r = await issue(completed().id)
    expect(await receipts.getFamilyClinicReceipt(FAMILY, MONARCA, 'mem_maria', r.id)).toMatchObject({ number: 1 })
    // Ana (adulta) não é titular nem tutora da Maria.
    expect(await code(receipts.listFamilyClinicReceipts(FAMILY, 'usr_ana', 'mem_maria'))).toBe('FORBIDDEN')
    expect(await code(receipts.getFamilyClinicReceipt(FAMILY, MONARCA, 'mem_monarca', r.id))).toBe('NOT_FOUND')
  })
})

describe('anexar recibos a um pedido de reembolso (BR-CLN-36)', () => {
  async function setup() {
    db.clinicConsents.push({ memberId: 'mem_maria', clinicId: 'cln_horizonte', level: 'BOOKINGS' })
    const r = await issue(completed().id)
    const policy = await insurance.createInsurancePolicy(FAMILY, MONARCA, 'mem_maria', {
      insurerId: db.insurers[0]!.id,
      insurerName: db.insurers[0]!.name,
      policyNumber: 'P-1',
      holderName: 'Maria',
      validUntil: null,
    })
    return { r, policy }
  }

  it('o recibo vale como comprovativo (sem documentos), mesma moeda, e a seguradora vê só o resumo', async () => {
    const { r, policy } = await setup()
    // Moeda diferente (EUR por omissão) ⇒ VALIDATION_ERROR, sem conversão.
    expect(
      await code(insurance.submitReimbursementClaim(FAMILY, MONARCA, 'mem_maria', policy.id, { amount: 15000, documentIds: [], receiptIds: [r.id] })),
    ).toBe('VALIDATION_ERROR')
    const claim = await insurance.submitReimbursementClaim(FAMILY, MONARCA, 'mem_maria', policy.id, {
      amount: 15000,
      currency: 'AOA',
      documentIds: [],
      receiptIds: [r.id],
    })
    expect(claim.receipts).toEqual([{ receiptId: r.id, number: 1, status: 'ISSUED', totalMinor: 1_500_000, currency: 'AOA' }])
    // Fica marcado como usado na cópia do paciente.
    expect((await receipts.getFamilyClinicReceipt(FAMILY, MONARCA, 'mem_maria', r.id)).attachedToClaimIds).toEqual([claim.id])

    const agent = db.insuranceAccounts.find((a) => a.insurerId === db.insurers[0]!.id)!
    const [view] = await insurancePortal.listInsuranceClaims(agent.id)
    expect(view!.receipts).toEqual([
      {
        number: 1,
        issuedAt: expect.any(String),
        clinicName: 'Clínica Horizonte',
        lines: [{ description: 'Consulta de cardiologia', amountMinor: 1_500_000 }],
        totalMinor: 1_500_000,
        currency: 'AOA',
        status: 'ISSUED',
      },
    ])
    expect(JSON.stringify(view)).not.toContain(r.id)
  })

  it('anulado, já anexado a pedido ativo ou não visível ⇒ erro; recusado liberta o recibo', async () => {
    const { r, policy } = await setup()
    const input = { amount: 15000, currency: 'AOA', documentIds: [], receiptIds: [r.id] }
    const claim = await insurance.submitReimbursementClaim(FAMILY, MONARCA, 'mem_maria', policy.id, input)
    expect(await code(insurance.submitReimbursementClaim(FAMILY, MONARCA, 'mem_maria', policy.id, input))).toBe('CONFLICT')
    db.reimbursementClaims.find((c) => c.id === claim.id)!.status = 'REJECTED'
    const again = await insurance.submitReimbursementClaim(FAMILY, MONARCA, 'mem_maria', policy.id, input)
    expect(again.receipts).toHaveLength(1)
    // Anulado.
    const second = await issue(completed().id)
    await receipts.voidClinicReceipt(MANAGER, second.id, 'motivo', NOW)
    expect(
      await code(insurance.submitReimbursementClaim(FAMILY, MONARCA, 'mem_maria', policy.id, { ...input, receiptIds: [second.id] })),
    ).toBe('CONFLICT')
    // Inexistente / de outro membro.
    expect(
      await code(insurance.submitReimbursementClaim(FAMILY, MONARCA, 'mem_maria', policy.id, { ...input, receiptIds: ['rcp_x'] })),
    ).toBe('NOT_FOUND')
    // Sem documentos nem recibos.
    expect(await code(insurance.submitReimbursementClaim(FAMILY, MONARCA, 'mem_maria', policy.id, { ...input, receiptIds: [] }))).toBe(
      'VALIDATION_ERROR',
    )
  })
})

describe('perfil da clínica (BR-CLN-38)', () => {
  it('o Admin edita; o Gestor lê mas não guarda; o Médico não vê nada', async () => {
    const before = await receipts.getClinicProfile(MANAGER)
    expect(before).toMatchObject({ name: 'Clínica Horizonte', currency: 'AOA' })
    expect(await code(receipts.updateClinicProfile(MANAGER, { phone: '999' }))).toBe('FORBIDDEN')
    expect(await code(receipts.getClinicProfile(DOCTOR))).toBe('FORBIDDEN')
    expect(await code(receipts.updateClinicProfile(DOCTOR, { phone: '999' }))).toBe('FORBIDDEN')

    const saved = await receipts.updateClinicProfile(ADMIN, { displayName: ' Horizonte Saúde ', phone: '+244 900 000 000', description: null })
    expect(saved).toMatchObject({ displayName: 'Horizonte Saúde', phone: '+244 900 000 000', description: null, name: 'Clínica Horizonte' })
  })

  it('valida limites, e-mail, campos só de leitura e corpo vazio', async () => {
    expect(await code(receipts.updateClinicProfile(ADMIN, {}))).toBe('VALIDATION_ERROR')
    expect(await code(receipts.updateClinicProfile(ADMIN, { email: 'nao-e-email' }))).toBe('VALIDATION_ERROR')
    expect(await code(receipts.updateClinicProfile(ADMIN, { description: 'x'.repeat(501) }))).toBe('VALIDATION_ERROR')
    expect(await code(receipts.updateClinicProfile(ADMIN, { displayName: '  ' }))).toBe('VALIDATION_ERROR')
    expect(await code(receipts.updateClinicProfile(ADMIN, { currency: 'EUR' } as never))).toBe('VALIDATION_ERROR')
    expect(await code(receipts.updateClinicProfile(ADMIN, { name: 'Outra' } as never))).toBe('VALIDATION_ERROR')
  })

  it('o paciente vê nome de apresentação, horário e descrição na lista de clínicas; o recibo usa o perfil do momento', async () => {
    const before = await issue(completed().id)
    await receipts.updateClinicProfile(ADMIN, { displayName: 'Horizonte Saúde', openingHours: 'Todos os dias 08–20' })
    const list = await clinics.listClinics(FAMILY)
    const horizonte = list.find((c) => c.id === 'cln_horizonte')!
    expect(horizonte).toMatchObject({ displayName: 'Horizonte Saúde', openingHours: 'Todos os dias 08–20' })
    expect(horizonte.address).toBeDefined()
    // O recibo já emitido guarda o retrato antigo (imutável).
    expect((await receipts.getClinicReceipt(MANAGER, before.id)).issuer.name).toBe('Clínica Horizonte')
    const after = await issue(completed().id)
    expect(after.issuer.name).toBe('Horizonte Saúde')
  })
})

describe('papel Médico: filtro por professionalId (BR-CLN-39)', () => {
  const addOther = (patch: Partial<Appointment> = {}) => {
    seq += 1
    db.slots.push({
      id: `slot_rui_${seq}`,
      clinicId: 'cln_horizonte',
      kind: 'APPOINTMENT',
      capacity: 1,
      specialty: 'Pediatria',
      professionalId: 'pro_rui',
      startsAt: at(0, '15:00', NOW),
      durationMinutes: 30,
    })
    const a: Appointment = {
      id: `apt_rui_${seq}`,
      familyId: FAMILY,
      memberId: 'mem_pedro',
      scheduledAt: at(0, '15:00', NOW),
      status: 'SCHEDULED',
      slotId: `slot_rui_${seq}`,
      specialty: 'Pediatria',
      clinicId: 'cln_horizonte',
      ...patch,
    }
    db.appointments.push(a)
    return a
  }

  it('a agenda só traz as marcações do seu profissional e sem receiptId', async () => {
    const mine = completed()
    const theirs = addOther()
    await issue(mine.id)
    const doctorView = await portal.listClinicAgenda(DOCTOR, NOW)
    expect(doctorView.some((b) => b.id === mine.id)).toBe(true)
    expect(doctorView.some((b) => b.id === theirs.id)).toBe(false)
    expect(doctorView.every((b) => b.receiptId === undefined)).toBe(true)
    // Receção vê as duas, com o recibo.
    const staffView = await portal.listClinicAgenda(MANAGER, NOW)
    expect(staffView.some((b) => b.id === theirs.id)).toBe(true)
    expect(staffView.find((b) => b.id === mine.id)?.receiptId).toBeDefined()
  })

  it('inicia, conclui e propõe retorno só nas suas; as dos outros ⇒ NOT_FOUND; chegada/falta ⇒ FORBIDDEN', async () => {
    const mine = completed({ status: 'SCHEDULED', scheduledAt: at(0, '11:00', NOW) })
    const theirs = addOther({ scheduledAt: at(0, '11:00', NOW) })
    expect(await code(clinicDay.startClinicBooking(DOCTOR, theirs.id, NOW))).toBe('NOT_FOUND')
    expect(await code(portal.completeClinicAppointment(DOCTOR, theirs.id, {}, NOW))).toBe('NOT_FOUND')
    expect(await code(clinicDay.arriveClinicBooking(DOCTOR, mine.id, NOW))).toBe('FORBIDDEN')
    expect(await code(clinicDay.noShowClinicBooking(DOCTOR, mine.id, NOW))).toBe('FORBIDDEN')
    expect(await code(clinicDay.confirmClinicBookingByPhone(DOCTOR, mine.id, NOW))).toBe('FORBIDDEN')
    expect(await code(portal.cancelClinicAppointment(DOCTOR, mine.id, 'x', NOW))).toBe('FORBIDDEN')
    expect(await clinicDay.startClinicBooking(DOCTOR, mine.id, NOW)).toMatchObject({ dayState: 'IN_PROGRESS' })
    expect(await portal.completeClinicAppointment(DOCTOR, mine.id, { outcomeNote: 'ok' }, NOW)).toMatchObject({ status: 'COMPLETED' })
    expect(await clinicDay.setClinicFollowUp(DOCTOR, mine.id, { amount: 2, unit: 'WEEKS' }, NOW)).toMatchObject({ status: 'COMPLETED' })
    // Mas não emite o recibo.
    expect(await code(issue(mine.id, {}, DOCTOR))).toBe('FORBIDDEN')
  })

  it('pacientes: só os que tiveram marcação com o seu profissional; sem pesquisa global, sem criar/ligar', async () => {
    const mine = completed({ memberId: 'mem_pedro' })
    const list = (await patients.listClinicPatients(DOCTOR, {}, NOW)).items
    const pedro = db.clinicPatients.find((p) => p.memberId === 'mem_pedro')!
    expect(list.map((p) => p.id)).toContain(pedro.id)
    const all = (await patients.listClinicPatients(MANAGER, {}, NOW)).items
    expect(all.length).toBeGreaterThan(list.length)

    const other = db.clinicPatients.find((p) => p.clinicId === 'cln_horizonte' && !list.some((l) => l.id === p.id))!
    expect(await code(patients.getClinicPatient(DOCTOR, other.id, NOW))).toBe('NOT_FOUND')
    expect(await code(patients.getClinicPatientRecord(DOCTOR, other.id, NOW))).toBe('NOT_FOUND')
    expect(await code(patients.getClinicSharedHistory(DOCTOR, other.id, NOW))).toBe('NOT_FOUND')
    expect(await patients.getClinicPatient(DOCTOR, pedro.id, NOW)).toMatchObject({ id: pedro.id })
    // A ficha traz só as marcações dele, sem receiptId.
    addOther() // Pedro também tem uma marcação com outro profissional.
    const record = await patients.getClinicPatientRecord(DOCTOR, pedro.id, NOW)
    expect(record.bookings.map((b) => b.id)).toEqual([mine.id])
    expect(record.bookings.every((b) => b.receiptId === undefined)).toBe(true)

    expect(await code(patients.clinicGlobalSearch(DOCTOR, 'Maria', NOW))).toBe('FORBIDDEN')
    expect(await code(patients.createClinicPatient(DOCTOR, { name: 'Novo' }, NOW))).toBe('FORBIDDEN')
    expect(await code(patients.updateClinicPatient(DOCTOR, pedro.id, { notes: 'x' }, NOW))).toBe('FORBIDDEN')
    expect(await code(patients.linkClinicPatient(DOCTOR, { code: 'ABCDEFGH' }, NOW))).toBe('FORBIDDEN')
  })

  it('calendário: só a sua coluna; o de outro profissional ⇒ NOT_FOUND; rotas de gestão ⇒ FORBIDDEN', async () => {
    const mine = completed({ scheduledAt: at(0, '10:00', NOW) })
    const theirs = addOther()
    const window = { from: at(0, '00:00', NOW), to: at(1, '00:00', NOW) }
    const calendar = await patients.getClinicCalendar(DOCTOR, window, NOW)
    expect(calendar.entries.map((e) => e.id)).toContain(mine.id)
    expect(calendar.entries.map((e) => e.id)).not.toContain(theirs.id)
    expect(calendar.freeSlots.every((s) => s.professionalId === 'pro_ana' || s.professionalName === 'Dr.ª Ana Costa')).toBe(true)
    expect(await code(patients.getClinicCalendar(DOCTOR, { ...window, professionalId: 'pro_rui' }, NOW))).toBe('NOT_FOUND')

    expect(await code(portal.listClinicRequests(DOCTOR, NOW))).toBe('FORBIDDEN')
    expect(await code(portal.listOwnClinicSlots(DOCTOR))).toBe('FORBIDDEN')
    expect(await code(clinicDay.getClinicReportSummary(DOCTOR, { from: '2026-11-01', to: '2026-11-30' }, NOW))).toBe('FORBIDDEN')
    expect(await code(portal.listClinicStaff(DOCTOR))).toBe('FORBIDDEN')
    expect(await code(receipts.listClinicAudit(DOCTOR))).toBe('FORBIDDEN')
  })

  it('exames e recomendações: só os seus', async () => {
    db.slots.push({
      id: 'slot_ex_ana',
      clinicId: 'cln_horizonte',
      kind: 'EXAM',
      capacity: 2,
      specialty: 'Ecocardiograma',
      professionalId: 'pro_ana',
      startsAt: at(0, '14:00', NOW),
      durationMinutes: 30,
    })
    db.slots.push({
      id: 'slot_ex_rui',
      clinicId: 'cln_horizonte',
      kind: 'EXAM',
      capacity: 2,
      specialty: 'Outro',
      professionalId: 'pro_rui',
      startsAt: at(0, '16:00', NOW),
      durationMinutes: 30,
    })
    const exam = (id: string, slotId: string) =>
      db.examinations.push({
        id,
        familyId: FAMILY,
        memberId: 'mem_maria',
        name: 'Exame',
        examDate: at(0, '14:00', NOW),
        status: 'SCHEDULED',
        clinicId: 'cln_horizonte',
        slotId,
      } as (typeof db.examinations)[number])
    exam('exm_ana', 'slot_ex_ana')
    exam('exm_rui', 'slot_ex_rui')
    expect((await portal.listClinicExamAgenda(DOCTOR)).map((e) => e.id).filter((id) => id.startsWith('exm_'))).toEqual(['exm_ana'])
    expect((await portal.listClinicExamAgenda(MANAGER)).filter((e) => e.id.startsWith('exm_'))).toHaveLength(2)
    expect(await code(portal.cancelClinicExam(DOCTOR, 'exm_ana', 'x'))).toBe('FORBIDDEN')
    expect(await code(portal.createClinicRecommendation(DOCTOR, { examinationId: 'exm_rui', text: 'Beber água' }, NOW))).toBe('NOT_FOUND')
    expect(await portal.createClinicRecommendation(DOCTOR, { examinationId: 'exm_ana', text: 'Beber água' }, NOW)).toMatchObject({
      text: 'Beber água',
    })
    expect(await portal.listClinicRecommendations(DOCTOR)).toHaveLength(1)
  })
})

describe('equipa: criar Gestor ou Médico (BR-CLN-05/39)', () => {
  it('Médico exige profissional ativo da clínica, único por profissional; Gestor não leva professionalId', async () => {
    const created = await portal.createClinicStaff(ADMIN, { email: 'Rui@clinicahorizonte.pt', role: 'CLINIC_DOCTOR', professionalId: 'pro_rui' })
    expect(created).toMatchObject({ role: 'CLINIC_DOCTOR', professionalId: 'pro_rui', email: 'rui@clinicahorizonte.pt' })
    expect(
      await code(portal.createClinicStaff(ADMIN, { email: 'outro@x.pt', role: 'CLINIC_DOCTOR', professionalId: 'pro_rui' })),
    ).toBe('CONFLICT')
    expect(await code(portal.createClinicStaff(ADMIN, { email: 'a@x.pt', role: 'CLINIC_DOCTOR', professionalId: 'pro_inexistente' }))).toBe('NOT_FOUND')
    expect(await code(portal.createClinicStaff(ADMIN, { email: 'b@x.pt', role: 'CLINIC_DOCTOR' }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.createClinicStaff(ADMIN, { email: 'c@x.pt', role: 'CLINIC_MANAGER', professionalId: 'pro_ines' }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.createClinicStaff(MANAGER, { email: 'd@x.pt' }))).toBe('FORBIDDEN')
    // Profissional inativo ou de outra clínica.
    db.professionals.find((p) => p.id === 'pro_ines')!.active = false
    expect(await code(portal.createClinicStaff(ADMIN, { email: 'e@x.pt', role: 'CLINIC_DOCTOR', professionalId: 'pro_ines' }))).toBe('NOT_FOUND')
    const staff = await portal.listClinicStaff(ADMIN)
    expect(staff.map((a) => a.role)).toEqual(expect.arrayContaining(['CLINIC_MANAGER', 'CLINIC_DOCTOR']))
    // Remover a conta Médico não apaga marcações.
    const before = db.appointments.length
    await portal.removeClinicStaff(ADMIN, created.id)
    expect(db.appointments).toHaveLength(before)
  })

  it('o login do Médico traz o professionalId na sessão', async () => {
    const result = await portal.clinicLogin('medica@clinicahorizonte.pt', 'password')
    expect(result).toMatchObject({ role: 'CLINIC_DOCTOR', professionalId: 'pro_ana' })
  })
})

describe('auditoria da clínica sem PII (BR-CLN-40)', () => {
  it('só o Admin a lê; lista as ações da própria clínica, mais recentes primeiro', async () => {
    const a = completed()
    const r = await issue(a.id)
    await receipts.voidClinicReceipt(MANAGER, r.id, 'Motivo confidencial', NOW)
    await receipts.updateClinicProfile(ADMIN, { phone: '+244 911 111 111', email: 'segredo@clinica.pt' })

    expect(await code(receipts.listClinicAudit(MANAGER))).toBe('FORBIDDEN')
    const page = await receipts.listClinicAudit(ADMIN, {}, NOW)
    const actions = page.items.map((e) => e.action)
    expect(actions).toEqual(expect.arrayContaining(['CLINIC_RECEIPT_ISSUE', 'CLINIC_RECEIPT_VOID', 'CLINIC_PROFILE_UPDATE']))
    // Nenhum dado pessoal: nem e-mails, nem telefones, nem o motivo da anulação, nem o nome do paciente.
    const text = JSON.stringify(page)
    for (const secret of ['Motivo confidencial', 'segredo@clinica.pt', '+244 911', 'Maria', 'rececao@clinicahorizonte.pt']) {
      expect(text).not.toContain(secret)
    }
    expect(Object.keys(page.items[0]!).sort()).toEqual(['action', 'actorAccountId', 'id', 'occurredAt', 'resourceId', 'resourceType', 'result'])
    const voidEntry = page.items.find((e) => e.action === 'CLINIC_RECEIPT_VOID')!
    expect(voidEntry.actorAccountId).toBe(MANAGER)
  })

  it('isola por clínica, filtra por ação e conta, pagina por cursor', async () => {
    await receipts.updateClinicProfile(ADMIN, { phone: '1 2 3 4 5' })
    await receipts.updateClinicProfile(OTHER, { phone: '9 9 9 9 9' })
    const own = await receipts.listClinicAudit(ADMIN)
    expect(own.items.every((e) => e.actorAccountId !== OTHER)).toBe(true)
    expect((await receipts.listClinicAudit(OTHER)).items.every((e) => e.actorAccountId === OTHER)).toBe(true)

    expect((await receipts.listClinicAudit(ADMIN, { action: 'CLINIC_PROFILE_UPDATE' })).items).toHaveLength(1)
    expect((await receipts.listClinicAudit(ADMIN, { actorAccountId: MANAGER })).items).toHaveLength(0)
    await receipts.updateClinicProfile(ADMIN, { phone: '5 5 5 5 5' })
    const first = await receipts.listClinicAudit(ADMIN, { limit: 1 })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBe('1')
    expect((await receipts.listClinicAudit(ADMIN, { limit: 1, cursor: first.nextCursor! })).items[0]!.id).not.toBe(first.items[0]!.id)
  })

  it('janela inválida ⇒ VALIDATION_ERROR; conta removida fica anonimizada', async () => {
    expect(await code(receipts.listClinicAudit(ADMIN, { from: '2026-11-05T00:00:00Z', to: '2026-11-01T00:00:00Z' }))).toBe('VALIDATION_ERROR')
    expect(await code(receipts.listClinicAudit(ADMIN, { from: '2024-01-01T00:00:00Z', to: '2026-11-01T00:00:00Z' }, NOW))).toBe('VALIDATION_ERROR')
    const staff = await portal.createClinicStaff(ADMIN, { email: 'temp@clinicahorizonte.pt' })
    await portal.clinicLogin('temp@clinicahorizonte.pt', 'password')
    await portal.removeClinicStaff(ADMIN, staff.id)
    const page = await receipts.listClinicAudit(ADMIN)
    expect(page.items.some((e) => e.actorAccountId === staff.id)).toBe(false)
    expect(page.items.some((e) => e.action === 'CLINIC_ACCOUNT_LOGIN' && e.actorAccountId === null)).toBe(true)
  })
})
