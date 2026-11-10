import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import { db, resetDb } from '../db'
import { at } from '../time'
import * as apt from './appointments'
import * as exams from './examinations'
import * as orders from './examOrders'
import * as portal from './clinicPortal'
import * as day from './clinicDay'

const ADMIN = 'cac_horizonte_admin'
const MANAGER = 'cac_horizonte_rececao'
const DOCTOR = 'cac_horizonte_medica' // profissional pro_ana
const OTHER_CLINIC = 'cac_vidaplena_admin'
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const ANA = 'usr_ana'
const NOW = new Date(2026, 10, 5, 12, 0)

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )
const pdfText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })

let seq = 0
/** Consulta Vita da Clínica Horizonte em curso, de um dado profissional. */
function booking(patch: Partial<Appointment> = {}, professionalId = 'pro_ana'): Appointment {
  seq += 1
  db.slots.push({
    id: `slot_xo_${seq}`,
    clinicId: 'cln_horizonte',
    kind: 'APPOINTMENT',
    capacity: 1,
    specialty: 'Cardiologia',
    professionalId,
    professionalName: 'Dr.ª Ana Costa',
    startsAt: at(0, '10:00', NOW),
    durationMinutes: 30,
  })
  const appointment: Appointment = {
    id: `apt_xo_${seq}`,
    familyId: FAMILY,
    memberId: 'mem_maria',
    scheduledAt: at(0, '10:00', NOW),
    status: 'SCHEDULED',
    slotId: `slot_xo_${seq}`,
    specialty: 'Cardiologia',
    professionalName: 'Dr.ª Ana Costa',
    clinicId: 'cln_horizonte',
    clinicName: 'Clínica Horizonte',
    ...patch,
  }
  db.appointments.push(appointment)
  return appointment
}

const item = (name: string, extra: object = {}) => ({ name, ...extra })

beforeEach(() => {
  resetDb(NOW)
  db.clinicAccounts.push({
    id: OTHER_CLINIC,
    clinicId: 'cln_vidaplena',
    email: 'admin@vidaplena.pt',
    password: 'x',
    role: 'CLINIC_ADMIN',
    status: 'ACTIVE',
  })
})

describe('pedido de exame: matriz de permissões (BR-CLN-51)', () => {
  it('só o Médico cria e cancela; Admin e Gestor leem e imprimem', async () => {
    const a = booking()
    expect(await code(orders.createClinicExamOrders(ADMIN, a.id, [item('Hemograma')], NOW))).toBe('FORBIDDEN')
    expect(await code(orders.createClinicExamOrders(MANAGER, a.id, [item('Hemograma')], NOW))).toBe('FORBIDDEN')
    expect(db.examOrders).toHaveLength(0)

    expect(await code(orders.createClinicExamOrders(DOCTOR, a.id, [item('Hemograma', { urgent: true })], NOW))).toBe('OK')
    const id = db.examOrders[0]!.id
    expect(await code(orders.cancelClinicExamOrder(ADMIN, a.id, id, NOW))).toBe('FORBIDDEN')
    expect(await code(orders.cancelClinicExamOrder(MANAGER, a.id, id, NOW))).toBe('FORBIDDEN')

    for (const reader of [ADMIN, MANAGER, DOCTOR]) {
      expect((await orders.listClinicExamOrders(reader, a.id)).items).toHaveLength(1)
      expect(await code(orders.getClinicExamOrdersPdf(reader, a.id))).toBe('OK')
    }
  })

  it('o Médico só age nas marcações do seu profissional; outra clínica ⇒ NOT_FOUND', async () => {
    const mine = booking()
    const theirs = booking({}, 'pro_ines')
    expect(await code(orders.createClinicExamOrders(DOCTOR, theirs.id, [item('X')], NOW))).toBe('NOT_FOUND')
    expect(await code(orders.listClinicExamOrders(DOCTOR, theirs.id))).toBe('NOT_FOUND')
    expect(await code(orders.listClinicExamOrders(OTHER_CLINIC, mine.id))).toBe('NOT_FOUND')
    expect(await code(orders.getClinicExamOrdersPdf(OTHER_CLINIC, mine.id))).toBe('NOT_FOUND')
  })

  it('complete com examOrders: Gestor ⇒ FORBIDDEN sem efeito parcial; Médico conclui e cria na mesma operação', async () => {
    const a = booking()
    expect(await code(portal.completeClinicAppointment(MANAGER, a.id, { outcomeNote: 'ok', examOrders: [item('ECG')] }, NOW))).toBe('FORBIDDEN')
    expect(db.appointments.find((x) => x.id === a.id)?.status).toBe('SCHEDULED')
    expect(db.examOrders).toHaveLength(0)

    // Inválido (nome e serviço ambos) ⇒ nada muda, nem a conclusão.
    expect(
      await code(portal.completeClinicAppointment(DOCTOR, a.id, { outcomeNote: 'ok', examOrders: [{ name: 'ECG', serviceTypeId: 'svc_eco' }] }, NOW)),
    ).toBe('VALIDATION_ERROR')
    expect(db.appointments.find((x) => x.id === a.id)?.status).toBe('SCHEDULED')

    const done = await portal.completeClinicAppointment(DOCTOR, a.id, { outcomeNote: 'ok', examOrders: [item('ECG'), item('Glicemia')] }, NOW)
    expect(done.status).toBe('COMPLETED')
    expect(done.examOrderCount).toBe(2)
    expect(db.examOrders).toHaveLength(2)
  })
})

describe('pedido de exame: regras (BR-CLN-51)', () => {
  it('1–5 itens; máximo de 5 ativos por marcação (LIMIT_EXCEEDED); cancelar liberta lugar', async () => {
    const a = booking()
    expect(await code(orders.createClinicExamOrders(DOCTOR, a.id, [], NOW))).toBe('VALIDATION_ERROR')
    expect(await code(orders.createClinicExamOrders(DOCTOR, a.id, Array.from({ length: 6 }, (_, i) => item(`E${i}`)), NOW))).toBe('VALIDATION_ERROR')
    await orders.createClinicExamOrders(DOCTOR, a.id, Array.from({ length: 4 }, (_, i) => item(`E${i}`)), NOW)
    expect(await code(orders.createClinicExamOrders(DOCTOR, a.id, [item('A'), item('B')], NOW))).toBe('LIMIT_EXCEEDED')
    expect(db.examOrders).toHaveLength(4)
    expect(await code(orders.createClinicExamOrders(DOCTOR, a.id, [item('A')], NOW))).toBe('OK')
    expect(await code(orders.createClinicExamOrders(DOCTOR, a.id, [item('B')], NOW))).toBe('LIMIT_EXCEEDED')
    await orders.cancelClinicExamOrder(DOCTOR, a.id, db.examOrders[0]!.id, NOW)
    expect(await code(orders.createClinicExamOrders(DOCTOR, a.id, [item('B')], NOW))).toBe('OK')
  })

  it.each([
    ['nome e serviço ambos', { name: 'X', serviceTypeId: 'svc_eco' }, 'VALIDATION_ERROR'],
    ['nem nome nem serviço', {}, 'VALIDATION_ERROR'],
    ['nome com 81 caracteres', { name: 'x'.repeat(81) }, 'VALIDATION_ERROR'],
    ['nota com 201 caracteres', { name: 'X', note: 'n'.repeat(201) }, 'VALIDATION_ERROR'],
    ['caracteres de controlo', { name: 'X\u0000' }, 'VALIDATION_ERROR'],
    ['serviço que não é de exame', { serviceTypeId: 'svc_cardio' }, 'VALIDATION_ERROR'],
    ['serviço inexistente/de outra clínica', { serviceTypeId: 'svc_nao_existe' }, 'NOT_FOUND'],
    ['serviço de exame ativo', { serviceTypeId: 'svc_eco' }, 'OK'],
  ])('item inválido: %s ⇒ %s', async (_label, input, expected) => {
    const a = booking()
    expect(await code(orders.createClinicExamOrders(DOCTOR, a.id, [input], NOW))).toBe(expected)
    if (expected === 'OK') expect(db.examOrders[0]).toMatchObject({ name: 'Ecografia abdominal', serviceTypeId: 'svc_eco', urgent: false })
  })

  it('marcação cancelada, que faltou ou pedida ⇒ CONFLICT', async () => {
    for (const status of ['CANCELLED', 'NO_SHOW', 'REQUESTED'] as const) {
      const a = booking({ status })
      expect(await code(orders.createClinicExamOrders(DOCTOR, a.id, [item('X')], NOW))).toBe('CONFLICT')
    }
  })

  it('consulta concluída ainda aceita pedidos; visita manual não cria ponte nem alerta', async () => {
    const done = booking({ status: 'COMPLETED' })
    await orders.createClinicExamOrders(DOCTOR, done.id, [item('X')], NOW)
    expect(db.examOrders[0]?.link).toBeDefined()

    db.clinicVisits.push({
      id: 'vis_xo',
      clinicId: 'cln_horizonte',
      clinicPatientId: 'cpt_helena',
      scheduledAt: at(0, '09:00', NOW),
      durationMinutes: 30,
      specialty: 'Medicina geral',
      status: 'SCHEDULED',
      professionalId: 'pro_ana',
    })
    const before = db.alerts.length
    expect(await code(orders.createClinicExamOrders(DOCTOR, 'vis_xo', [item('Y')], NOW))).toBe('OK')
    const visitOrder = db.examOrders.find((o) => o.bookingId === 'vis_xo')
    expect(visitOrder?.bookingKind).toBe('VISIT')
    expect(visitOrder?.link).toBeUndefined()
    expect(db.alerts.length).toBe(before)
    // Retrato do paciente da clínica (data de nascimento só se existe).
    expect((await orders.listClinicExamOrders(DOCTOR, 'vis_xo')).items[0]?.patientName).toBeTruthy()
  })

  it('cancelar é idempotente e o pedido cancelado não conta nem imprime', async () => {
    const a = booking()
    await orders.createClinicExamOrders(DOCTOR, a.id, [item('X')], NOW)
    const id = db.examOrders[0]!.id
    expect((await orders.cancelClinicExamOrder(DOCTOR, a.id, id, NOW)).status).toBe('CANCELLED')
    expect((await orders.cancelClinicExamOrder(DOCTOR, a.id, id, NOW)).status).toBe('CANCELLED')
    expect((await portal.listClinicAgenda(DOCTOR, NOW)).find((b) => b.id === a.id)?.examOrderCount).toBe(0)
    expect(await code(orders.getClinicExamOrdersPdf(DOCTOR, a.id))).toBe('NOT_FOUND')
  })

  it('PDF só com texto dos pedidos ativos e rodapé "Documento não fiscal"', async () => {
    const a = booking()
    await orders.createClinicExamOrders(DOCTOR, a.id, [item('Hemograma', { urgent: true, note: 'Jejum' }), item('Glicemia')], NOW)
    const text = await pdfText(await orders.getClinicExamOrdersPdf(MANAGER, a.id))
    expect(text).toMatch(/PEDIDO DE EXAME/)
    expect(text).toMatch(/Hemograma - URGENTE/)
    expect(text).toMatch(/Documento n.+fiscal/)
  })
})

describe('pedido de exame: paciente Vita (BR-CLN-52/53)', () => {
  it('cria um alerta genérico EXAM_ORDER_ADDED por pedido, sem o nome do exame', async () => {
    const a = booking()
    await orders.createClinicExamOrders(DOCTOR, a.id, [item('Hemograma secreto'), item('Outro')], NOW)
    const added = db.alerts.filter((al) => al.type === 'EXAM_ORDER_ADDED')
    expect(added).toHaveLength(2)
    expect(added.every((al) => al.recipientUserId === MONARCA && al.sourceId === a.id)).toBe(true)
    const list = await apt.listAppointments(FAMILY, MONARCA)
    expect(list.find((i) => i.appointment.id === a.id)?.appointment.examOrderCount).toBe(2)
  })

  it('titular/tutor leem; quem não gere o membro ⇒ FORBIDDEN; por omissão exclui cancelados', async () => {
    const a = booking()
    await orders.createClinicExamOrders(DOCTOR, a.id, [item('A'), item('B')], NOW)
    await orders.cancelClinicExamOrder(DOCTOR, a.id, db.examOrders[1]!.id, NOW)
    const { items } = await orders.listFamilyExamOrders(FAMILY, MONARCA, 'mem_maria')
    expect(items.map((o) => o.name)).toEqual(['A'])
    expect(items[0]).toMatchObject({ status: 'ORDERED', clinicName: 'Clínica Horizonte', appointmentId: a.id })
    expect(Object.keys(items[0]!)).not.toContain('authorName')
    expect((await orders.listFamilyExamOrders(FAMILY, MONARCA, 'mem_maria', { status: 'CANCELLED' })).items).toHaveLength(1)
    expect(await code(orders.listFamilyExamOrders(FAMILY, ANA, 'mem_maria'))).toBe('FORBIDDEN')
  })

  async function ordered(name = 'Hemograma') {
    const a = booking({ status: 'COMPLETED' })
    await orders.createClinicExamOrders(DOCTOR, a.id, [item(name)], NOW)
    return { a, order: db.examOrders[0]! }
  }
  const examInput = (extra: object) => ({
    memberId: 'mem_maria',
    name: 'Hemograma',
    examDate: '2026-11-20',
    results: [],
    documents: [],
    ...extra,
  })

  it('marcar com examOrderId liga na mesma operação: ORDERED → SCHEDULED → FULFILLED (na própria clínica)', async () => {
    const { a, order } = await ordered()
    const exam = await exams.createExamination(FAMILY, MONARCA, examInput({ clinicName: 'Clínica Horizonte', examOrderId: order.id }), NOW)
    expect(exam.status).toBe('SCHEDULED')
    expect((await orders.listFamilyExamOrders(FAMILY, MONARCA, 'mem_maria')).items[0]).toMatchObject({ status: 'SCHEDULED', examinationId: exam.id })
    expect((await orders.listClinicExamOrders(DOCTOR, a.id)).items[0]?.status).toBe('SCHEDULED')

    await exams.setExaminationStatus(FAMILY, MONARCA, exam.id, 'COMPLETED')
    expect((await orders.listFamilyExamOrders(FAMILY, MONARCA, 'mem_maria')).items[0]?.status).toBe('FULFILLED')
    // Cumprido visível à clínica ⇒ já não se cancela.
    expect(await code(orders.cancelClinicExamOrder(DOCTOR, a.id, order.id, NOW))).toBe('CONFLICT')
  })

  it('exame cancelado desfaz a ligação e o pedido volta a ORDERED; um segundo exame ligado ⇒ CONFLICT', async () => {
    const { order } = await ordered()
    const exam = await exams.createExamination(FAMILY, MONARCA, examInput({ clinicName: 'Clínica Horizonte', examOrderId: order.id }), NOW)
    expect(await code(exams.createExamination(FAMILY, MONARCA, examInput({ examOrderId: order.id }), NOW))).toBe('CONFLICT')
    await exams.setExaminationStatus(FAMILY, MONARCA, exam.id, 'CANCELLED')
    expect((await orders.listFamilyExamOrders(FAMILY, MONARCA, 'mem_maria')).items[0]).toMatchObject({ status: 'ORDERED', examinationId: undefined })
    expect(await code(exams.createExamination(FAMILY, MONARCA, examInput({ examOrderId: order.id }), NOW))).toBe('OK')
  })

  it('isolamento: marcado noutra clínica, a de origem continua a ver ORDERED (booked_here)', async () => {
    const { a, order } = await ordered()
    await exams.createExamination(FAMILY, MONARCA, examInput({ clinicName: 'Laboratório Outro', examOrderId: order.id }), NOW)
    expect((await orders.listFamilyExamOrders(FAMILY, MONARCA, 'mem_maria')).items[0]?.status).toBe('SCHEDULED')
    expect((await orders.listClinicExamOrders(DOCTOR, a.id)).items[0]?.status).toBe('ORDERED')
    // E a clínica pode cancelar: não vê nada marcado; o exame do paciente não é tocado.
    expect((await orders.cancelClinicExamOrder(DOCTOR, a.id, order.id, NOW)).status).toBe('CANCELLED')
    expect(db.examinations.find((e) => e.clinicName === 'Laboratório Outro')?.status).toBe('SCHEDULED')
  })

  it('pedido de outro membro/inexistente ⇒ NOT_FOUND; sem examOrderId os pedidos não são tocados', async () => {
    const { order } = await ordered()
    expect(await code(exams.createExamination(FAMILY, MONARCA, examInput({ memberId: 'mem_monarca', examOrderId: order.id }), NOW))).toBe('NOT_FOUND')
    expect(await code(exams.createExamination(FAMILY, MONARCA, examInput({ examOrderId: 'xor_nao_existe' }), NOW))).toBe('NOT_FOUND')
    await exams.createExamination(FAMILY, MONARCA, examInput({}), NOW)
    expect((await orders.listFamilyExamOrders(FAMILY, MONARCA, 'mem_maria')).items[0]?.status).toBe('ORDERED')
  })
})

describe('declaração de presença (BR-CLN-55)', () => {
  it('elegível: concluída ou agendada com chegada; senão CONFLICT', async () => {
    const waiting = booking()
    expect(await code(orders.getClinicAttendanceStatementPdf(ADMIN, waiting.id, false, NOW))).toBe('CONFLICT')
    await day.arriveClinicBooking(MANAGER, waiting.id, NOW)
    expect(await code(orders.getClinicAttendanceStatementPdf(ADMIN, waiting.id, false, NOW))).toBe('OK')
    expect(await code(orders.getClinicAttendanceStatementPdf(DOCTOR, waiting.id, false, NOW))).toBe('OK')

    expect(await code(orders.getClinicAttendanceStatementPdf(ADMIN, booking({ status: 'COMPLETED' }).id, false, NOW))).toBe('OK')
    for (const status of ['NO_SHOW', 'CANCELLED', 'REQUESTED'] as const) {
      expect(await code(orders.getClinicAttendanceStatementPdf(ADMIN, booking({ status }).id, false, NOW))).toBe('CONFLICT')
    }
    // Outro profissional/clínica ⇒ NOT_FOUND.
    expect(await code(orders.getClinicAttendanceStatementPdf(DOCTOR, booking({ status: 'COMPLETED' }, 'pro_ines').id, false, NOW))).toBe('NOT_FOUND')
    expect(await code(orders.getClinicAttendanceStatementPdf(OTHER_CLINIC, waiting.id, false, NOW))).toBe('NOT_FOUND')
  })

  it('só com o profissional se pedido; nunca especialidade; cada emissão fica auditada', async () => {
    const a = booking({ status: 'COMPLETED' })
    const plain = await pdfText(await orders.getClinicAttendanceStatementPdf(ADMIN, a.id, false, NOW))
    expect(plain).toMatch(/Declara-se que o\/a paciente/)
    expect(plain).not.toMatch(/Ana Costa/)
    expect(plain).not.toMatch(/Cardiologia/)
    const withPro = await pdfText(await orders.getClinicAttendanceStatementPdf(ADMIN, a.id, true, NOW))
    expect(withPro).toMatch(/Profissional: .*Ana Costa/)
    expect(withPro).not.toMatch(/Cardiologia/)
    expect(db.clinicAudit.filter((e) => e.action === 'ATTENDANCE_STATEMENT_ISSUED')).toHaveLength(2)
  })
})

describe('catálogo de exames da clínica (GET /clinic-portal/exam-service-types)', () => {
  it('só EXAM ativos da própria clínica, sem preço, para todos os papéis', async () => {
    const own = db.services.find((s) => s.clinicId === 'cln_horizonte' && s.kind === 'EXAM' && s.active)!
    const inactive = { ...own, id: 'srv_inativo', name: 'Inativo', active: false }
    const consult = db.services.find((s) => s.clinicId === 'cln_horizonte' && s.kind === 'APPOINTMENT')!
    db.services.push(inactive)
    for (const account of [ADMIN, MANAGER, DOCTOR]) {
      const options = await orders.listClinicExamServiceTypes(account)
      expect(options.map((o) => o.id)).toContain(own.id)
      expect(options.map((o) => o.id)).not.toContain(inactive.id)
      expect(options.map((o) => o.id)).not.toContain(consult.id)
      expect(JSON.stringify(options)).not.toMatch(/price|currency/i)
    }
    const other = await orders.listClinicExamServiceTypes(OTHER_CLINIC)
    expect(other.map((o) => o.id)).not.toContain(own.id)
  })
})
