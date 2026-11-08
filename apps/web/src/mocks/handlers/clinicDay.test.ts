import { beforeEach, describe, expect, it } from 'vitest'
import { addFollowUp, deriveDayState, waitingMinutesOf } from '@/lib/clinicDay'
import type { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import { db, resetDb } from '../db'
import { at, day } from '../time'
import * as alerts from './alerts'
import * as appointments from './appointments'
import * as clinicDay from './clinicDay'
import * as patients from './clinicPatients'
import * as portal from './clinicPortal'

const ADMIN = 'cac_horizonte_admin'
const MANAGER = 'cac_horizonte_rececao'
const OTHER = 'cac_vidaplena_admin'
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
/** Quinta-feira, 08:00 locais. */
const NOW = new Date(2026, 10, 5, 8, 0)
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

let seq = 0
/** Consulta Vita da Clínica Horizonte (membro Maria) a `dayOffset` dias de NOW, às `time`. */
function addAppointment(dayOffset: number, time: string, patch: Partial<Appointment> = {}): Appointment {
  const appointment: Appointment = {
    id: `apt_test_${++seq}`,
    familyId: FAMILY,
    memberId: 'mem_maria',
    scheduledAt: at(dayOffset, time, NOW),
    status: 'SCHEDULED',
    slotId: `slot_test_${seq}`,
    specialty: 'Dermatologia',
    clinicId: 'cln_horizonte',
    clinicName: 'Clínica Horizonte',
    ...patch,
  }
  db.appointments.push(appointment)
  return appointment
}

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

describe('estado do dia derivado (BR-CLN-28)', () => {
  it('SCHEDULED → ARRIVED → IN_PROGRESS; os restantes mantêm-se', () => {
    expect(deriveDayState('SCHEDULED')).toBe('SCHEDULED')
    expect(deriveDayState('SCHEDULED', '2026-11-05T08:00:00Z')).toBe('ARRIVED')
    expect(deriveDayState('SCHEDULED', '2026-11-05T08:00:00Z', '2026-11-05T08:10:00Z')).toBe('IN_PROGRESS')
    expect(deriveDayState('COMPLETED', '2026-11-05T08:00:00Z')).toBe('COMPLETED')
    expect(deriveDayState('NO_SHOW')).toBe('NO_SHOW')
  })

  it('espera em minutos inteiros até ao início ou até agora; nula sem chegada', () => {
    const arrived = at(0, '08:00', NOW)
    expect(waitingMinutesOf(undefined, undefined, NOW)).toBeNull()
    expect(waitingMinutesOf(arrived, undefined, later(12.9))).toBe(12)
    expect(waitingMinutesOf(arrived, later(5).toISOString(), later(60))).toBe(5)
    expect(waitingMinutesOf(arrived, undefined, later(-3))).toBe(0)
  })

  it('"voltar em N": semanas e meses', () => {
    expect(addFollowUp('2026-11-05', { amount: 2, unit: 'WEEKS' })).toBe('2026-11-19')
    expect(addFollowUp('2026-11-05', { amount: 3, unit: 'MONTHS' })).toBe('2027-02-05')
  })
})

describe('chegou / iniciar só no dia (BR-CLN-28)', () => {
  it('"Chegou" e "Iniciar" fora do dia local dão conflito', async () => {
    const tomorrow = addAppointment(1, '09:00')
    const yesterday = addAppointment(-1, '09:00')
    expect(await code(clinicDay.arriveClinicBooking(ADMIN, tomorrow.id, NOW))).toBe('CONFLICT')
    expect(await code(clinicDay.startClinicBooking(ADMIN, tomorrow.id, NOW))).toBe('CONFLICT')
    expect(await code(clinicDay.arriveClinicBooking(ADMIN, yesterday.id, NOW))).toBe('CONFLICT')
  })

  it('no dia: Chegou define arrivedAt uma só vez; Iniciar acrescenta startedAt; a consulta continua SCHEDULED', async () => {
    const today = addAppointment(0, '09:00')
    const arrived = await clinicDay.arriveClinicBooking(MANAGER, today.id, NOW)
    expect(arrived).toMatchObject({ status: 'SCHEDULED', dayState: 'ARRIVED', waitingMinutes: 0 })
    const again = await clinicDay.arriveClinicBooking(MANAGER, today.id, later(20))
    expect(again.arrivedAt).toBe(arrived.arrivedAt)
    expect(again.waitingMinutes).toBe(20)

    const started = await clinicDay.startClinicBooking(MANAGER, today.id, later(30))
    expect(started).toMatchObject({ status: 'SCHEDULED', dayState: 'IN_PROGRESS', waitingMinutes: 30 })
    // Idempotente: o primeiro instante mantém-se e a espera deixa de crescer.
    const repeated = await clinicDay.startClinicBooking(MANAGER, today.id, later(90))
    expect(repeated.startedAt).toBe(started.startedAt)
    expect(repeated.waitingMinutes).toBe(30)
  })

  it('Iniciar sem Chegou define também arrivedAt; visitas manuais usam o mesmo despacho', async () => {
    const today = addAppointment(0, '09:00')
    expect(await clinicDay.startClinicBooking(ADMIN, today.id, NOW)).toMatchObject({
      dayState: 'IN_PROGRESS',
      waitingMinutes: 0,
    })
    db.clinicVisits.push({
      id: 'vis_hoje',
      clinicId: 'cln_horizonte',
      clinicPatientId: 'cpt_helena',
      scheduledAt: at(0, '10:00', NOW),
      durationMinutes: 30,
      status: 'SCHEDULED',
    })
    expect(await clinicDay.arriveClinicBooking(ADMIN, 'vis_hoje', NOW)).toMatchObject({
      source: 'MANUAL',
      dayState: 'ARRIVED',
    })
  })

  it('concluir continua a aceitar a consulta em qualquer estado do dia', async () => {
    const today = addAppointment(0, '07:30')
    await clinicDay.startClinicBooking(ADMIN, today.id, NOW)
    const done = await portal.completeClinicAppointment(ADMIN, today.id, { outcomeNote: 'Ok.' }, NOW)
    expect(done).toMatchObject({ status: 'COMPLETED', dayState: 'COMPLETED' })
  })
})

describe('faltou e desfazer a falta (BR-CLN-28)', () => {
  it('só marca falta quando a hora já começou e sem atendimento iniciado; é idempotente', async () => {
    const future = addAppointment(0, '09:00')
    expect(await code(clinicDay.noShowClinicBooking(ADMIN, future.id, NOW))).toBe('CONFLICT')
    const past = addAppointment(0, '07:00')
    const missed = await clinicDay.noShowClinicBooking(ADMIN, past.id, NOW)
    expect(missed).toMatchObject({ status: 'NO_SHOW', dayState: 'NO_SHOW' })
    expect(await code(clinicDay.noShowClinicBooking(ADMIN, past.id, NOW))).toBe('OK')

    const started = addAppointment(0, '07:15')
    await clinicDay.startClinicBooking(ADMIN, started.id, NOW)
    expect(await code(clinicDay.noShowClinicBooking(ADMIN, started.id, NOW))).toBe('CONFLICT')
  })

  it('"Chegou" a partir de NO_SHOW volta a SCHEDULED (chegou tarde) — só no dia', async () => {
    const past = addAppointment(0, '07:00')
    await clinicDay.noShowClinicBooking(ADMIN, past.id, NOW)
    const back = await clinicDay.arriveClinicBooking(ADMIN, past.id, later(30))
    expect(back).toMatchObject({ status: 'SCHEDULED', dayState: 'ARRIVED' })

    const yesterday = addAppointment(-1, '09:00', { status: 'NO_SHOW' })
    expect(await code(clinicDay.arriveClinicBooking(ADMIN, yesterday.id, NOW))).toBe('CONFLICT')
  })

  it('a falta não reabre o horário (BR-APT-06 só liberta cancelamentos)', async () => {
    const past = addAppointment(0, '07:00')
    await clinicDay.noShowClinicBooking(ADMIN, past.id, NOW)
    const slot = (await patients.getClinicCalendar(ADMIN, { from: at(0, '00:00', NOW), to: at(1, '00:00', NOW) }, NOW))
      .freeSlots
    expect(slot.some((s) => s.slotId === past.slotId)).toBe(false)
  })
})

describe('confirmação separada do estado (BR-CLN-25/26/27)', () => {
  it('"confirmado por telefone": CONFIRMED/CLINIC; o estado da consulta não muda; passada ou concluída dá conflito', async () => {
    const future = addAppointment(1, '09:00')
    expect((await portal.listClinicAgenda(ADMIN, NOW)).find((b) => b.id === future.id)).toMatchObject({
      confirmationStatus: 'PENDING',
    })
    const confirmed = await clinicDay.confirmClinicBookingByPhone(MANAGER, future.id, NOW)
    expect(confirmed).toMatchObject({ status: 'SCHEDULED', confirmationStatus: 'CONFIRMED', confirmationSource: 'CLINIC' })
    // Idempotente.
    expect(await code(clinicDay.confirmClinicBookingByPhone(MANAGER, future.id, NOW))).toBe('OK')

    const past = addAppointment(0, '07:00')
    expect(await code(clinicDay.confirmClinicBookingByPhone(ADMIN, past.id, NOW))).toBe('CONFLICT')
    // Os desfechos guardam a confirmação como estava (histórico).
    await portal.completeClinicAppointment(ADMIN, future.id, { outcomeNote: 'Ok.' }, later(48 * 60))
    const [booking] = (await portal.listClinicAgenda(ADMIN, later(48 * 60))).filter((b) => b.id === future.id)
    expect(booking).toMatchObject({ status: 'COMPLETED', confirmationStatus: 'CONFIRMED' })
  })

  it('visitas manuais também se confirmam por telefone (único canal) e nunca ficam DECLINED', async () => {
    db.clinicVisits.push({
      id: 'vis_amanha',
      clinicId: 'cln_horizonte',
      clinicPatientId: 'cpt_helena',
      scheduledAt: at(1, '10:00', NOW),
      durationMinutes: 30,
      status: 'SCHEDULED',
    })
    expect(await clinicDay.confirmClinicBookingByPhone(ADMIN, 'vis_amanha', NOW)).toMatchObject({
      source: 'MANUAL',
      confirmationStatus: 'CONFIRMED',
      confirmationSource: 'CLINIC',
    })
  })

  it('família: "Vou" confirma (PATIENT); "Não posso" cancela, liberta o horário e fica DECLINED', async () => {
    const going = addAppointment(2, '09:00')
    expect(await appointments.setAppointmentConfirmation(FAMILY, MONARCA, going.id, 'GOING', NOW)).toMatchObject({
      status: 'SCHEDULED',
      confirmationStatus: 'CONFIRMED',
      confirmationSource: 'PATIENT',
    })
    // Pode mudar de ideias até à hora.
    const cannot = await appointments.setAppointmentConfirmation(FAMILY, MONARCA, going.id, 'CANNOT', NOW)
    expect(cannot).toMatchObject({ status: 'CANCELLED', confirmationStatus: 'DECLINED' })
    expect(cannot.responseNote).toBeUndefined()
    // Idempotente; "Vou" depois de "Não posso" não é possível (pede-se novo horário).
    expect(await code(appointments.setAppointmentConfirmation(FAMILY, MONARCA, going.id, 'CANNOT', NOW))).toBe('OK')
    expect(await code(appointments.setAppointmentConfirmation(FAMILY, MONARCA, going.id, 'GOING', NOW))).toBe('CONFLICT')
    // A clínica não pode confirmar uma recusa por telefone.
    expect(await code(clinicDay.confirmClinicBookingByPhone(ADMIN, going.id, NOW))).toBe('CONFLICT')
  })

  it('família: só consultas SCHEDULED, futuras e de clínica parceira; só do seu âmbito', async () => {
    const noSlot = addAppointment(2, '09:00', { slotId: undefined })
    expect(await code(appointments.setAppointmentConfirmation(FAMILY, MONARCA, noSlot.id, 'GOING', NOW))).toBe('VALIDATION_ERROR')
    const past = addAppointment(0, '07:00')
    expect(await code(appointments.setAppointmentConfirmation(FAMILY, MONARCA, past.id, 'GOING', NOW))).toBe('CONFLICT')
    const requested = addAppointment(2, '09:00', { status: 'REQUESTED' })
    expect(await code(appointments.setAppointmentConfirmation(FAMILY, MONARCA, requested.id, 'GOING', NOW))).toBe('CONFLICT')
    expect(await code(appointments.setAppointmentConfirmation(FAMILY, 'usr_ana', 'apt_cardio', 'GOING', NOW))).toBe('NOT_FOUND')
  })

  it('a recusa aparece na agenda e no calendário da clínica, com o horário livre', async () => {
    const declined = addAppointment(0, '15:00')
    await appointments.setAppointmentConfirmation(FAMILY, MONARCA, declined.id, 'CANNOT', NOW)
    const agenda = await portal.listClinicAgenda(ADMIN, NOW)
    expect(agenda.find((b) => b.id === declined.id)).toMatchObject({ status: 'CANCELLED', confirmationStatus: 'DECLINED' })
    const calendar = await patients.getClinicCalendar(ADMIN, { from: at(0, '00:00', NOW), to: at(1, '00:00', NOW) }, NOW)
    expect(calendar.entries.find((e) => e.id === declined.id)).toMatchObject({
      status: 'CANCELLED',
      confirmationStatus: 'DECLINED',
      dayState: 'CANCELLED',
    })
  })

  it('o calendário traz confirmação, estado do dia e espera; exames sem confirmação', async () => {
    const today = addAppointment(0, '09:00')
    await clinicDay.arriveClinicBooking(ADMIN, today.id, NOW)
    const calendar = await patients.getClinicCalendar(ADMIN, { from: at(0, '00:00', NOW), to: at(1, '00:00', NOW) }, later(7))
    expect(calendar.entries.find((e) => e.id === today.id)).toMatchObject({
      confirmationStatus: 'PENDING',
      dayState: 'ARRIVED',
      waitingMinutes: 7,
    })
  })
})

describe('alertas de confirmação e de retorno (BR-ALR-09, BR-CLN-30)', () => {
  const rules = async (sourceId: string, now: Date) =>
    (await alerts.listAlerts(FAMILY, MONARCA, now)).filter((a) => a.sourceId === sourceId).map((a) => a.ruleKey)

  it('pedido de confirmação a 48 h só se estiver sem resposta e não tiver sido marcada à última hora', async () => {
    const pending = addAppointment(2, '09:00')
    const confirmed = addAppointment(2, '10:00', { confirmationStatus: 'CONFIRMED', confirmationSource: 'CLINIC' })
    const late = addAppointment(2, '11:00', { scheduledSince: later(60).toISOString() })
    const noSlot = addAppointment(2, '12:00', { slotId: undefined })
    expect(await rules(pending.id, NOW)).toEqual([])
    const afterTrigger = new Date(Date.parse(pending.scheduledAt) - 47 * 3_600_000)
    expect(await rules(pending.id, afterTrigger)).toEqual(['appointment.confirm48h'])
    expect(await rules(confirmed.id, afterTrigger)).toEqual([])
    expect(await rules(late.id, afterTrigger)).toEqual([])
    expect(await rules(noSlot.id, afterTrigger)).toEqual([])
  })

  it('o alerta indica se ainda se pode responder (confirmable) e deixa de o indicar após responder', async () => {
    const pending = addAppointment(2, '09:00')
    const afterTrigger = new Date(Date.parse(pending.scheduledAt) - 47 * 3_600_000)
    const find = async () => (await alerts.listAlerts(FAMILY, MONARCA, afterTrigger)).find((a) => a.sourceId === pending.id)
    expect(await find()).toMatchObject({ type: 'APPOINTMENT_CONFIRM_REQUEST', confirmable: true, targetId: pending.id })
    await appointments.setAppointmentConfirmation(FAMILY, MONARCA, pending.id, 'GOING', afterTrigger)
    expect(await find()).toMatchObject({ confirmable: false })
  })

  it('retorno de consulta Vita: um alerta FOLLOWUP_REMINDER 7 dias antes; visita manual não gera alerta', async () => {
    const done = addAppointment(-10, '09:00', { status: 'COMPLETED' })
    await portal.listClinicAgenda(ADMIN, NOW)
    await clinicDay.setClinicFollowUp(ADMIN, done.id, { amount: 3, unit: 'WEEKS' }, NOW)
    const due = (await portal.listClinicAgenda(ADMIN, NOW)).find((b) => b.id === done.id)!.followUpDueOn!
    expect(due).toBe(addFollowUp(day(-10, NOW), { amount: 3, unit: 'WEEKS' }))
    // Antes de dueOn-7d não há alerta; depois, um só.
    const before = new Date(`${addFollowUpDays(due, -8)}T12:00:00`)
    const after = new Date(`${addFollowUpDays(due, -6)}T12:00:00`)
    expect(await rules(done.id, before)).toEqual([])
    expect(await rules(done.id, after)).toEqual(['followup.due'])
    expect(await rules(done.id, after)).toEqual(['followup.due'])
    const [alert] = (await alerts.listAlerts(FAMILY, MONARCA, after)).filter((a) => a.sourceId === done.id)
    expect(alert).toMatchObject({ type: 'FOLLOWUP_REMINDER', targetId: done.id })

    // Visita manual (seed): retorno a contactar, sem alerta para ninguém.
    const visitAlerts = (await alerts.listAlerts(FAMILY, MONARCA, after)).filter((a) => a.sourceId === 'vis_helena_passada')
    expect(visitAlerts).toEqual([])
  })

  it('limpar o retorno antes do alerta cancela-o', async () => {
    const done = addAppointment(-10, '09:00', { status: 'COMPLETED' })
    await clinicDay.setClinicFollowUp(ADMIN, done.id, { amount: 3, unit: 'WEEKS' }, NOW)
    await clinicDay.clearClinicFollowUp(ADMIN, done.id, NOW)
    expect(await rules(done.id, later(24 * 60 * 30))).toEqual([])
  })
})

function addFollowUpDays(day: string, days: number): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

describe('retorno: voltar em N semanas/meses (BR-CLN-30)', () => {
  it('só em marcações concluídas; valida o prazo; substitui e limpa', async () => {
    const scheduled = addAppointment(1, '09:00')
    expect(await code(clinicDay.setClinicFollowUp(ADMIN, scheduled.id, { amount: 2, unit: 'WEEKS' }, NOW))).toBe('CONFLICT')
    const done = addAppointment(-3, '09:00', { status: 'COMPLETED' })
    for (const amount of [0, 25, 1.5]) {
      expect(await code(clinicDay.setClinicFollowUp(ADMIN, done.id, { amount, unit: 'WEEKS' }, NOW))).toBe('VALIDATION_ERROR')
    }
    const first = await clinicDay.setClinicFollowUp(ADMIN, done.id, { amount: 2, unit: 'WEEKS' }, NOW)
    expect(first.followUpDueOn).toBe(addFollowUp(day(-3, NOW), { amount: 2, unit: 'WEEKS' }))
    const replaced = await clinicDay.setClinicFollowUp(ADMIN, done.id, { amount: 6, unit: 'MONTHS' }, NOW)
    expect(replaced.followUpDueOn).toBe(addFollowUp(day(-3, NOW), { amount: 6, unit: 'MONTHS' }))
    expect((await clinicDay.clearClinicFollowUp(ADMIN, done.id, NOW)).followUpDueOn).toBeUndefined()
    expect(await code(clinicDay.clearClinicFollowUp(ADMIN, done.id, NOW))).toBe('OK')
  })

  it('"retornos a contactar": ordenados, com telefone do registo, sem ids Vita; limite por `until`', async () => {
    const done = addAppointment(-3, '09:00', { status: 'COMPLETED', memberId: 'mem_monarca' })
    await clinicDay.setClinicFollowUp(ADMIN, done.id, { amount: 2, unit: 'WEEKS' }, NOW)
    const list = await clinicDay.listClinicFollowUps(MANAGER, undefined, NOW)
    // Visita manual de Helena (seed, +9 dias) e a consulta Vita (+11 dias): ordenadas por data.
    expect(list.map((i) => [i.source, i.patientName])).toEqual([
      ['MANUAL', 'Helena Baptista'],
      ['VITA', 'Monarca Lopes'],
    ])
    expect(list[0]).toMatchObject({ patientPhone: '+244 924 555 010', patientNotified: false })
    expect(list[1]).toMatchObject({ patientNotified: false })
    expect(JSON.stringify(list)).not.toMatch(/mem_|usr_|fam_|memberId/)
    expect(await clinicDay.listClinicFollowUps(MANAGER, day(5, NOW), NOW)).toEqual([])
    expect(await code(clinicDay.listClinicFollowUps(MANAGER, 'amanhã', NOW))).toBe('VALIDATION_ERROR')
    // Perto da data, a consulta Vita já foi notificada.
    const near = await clinicDay.listClinicFollowUps(MANAGER, undefined, new Date(`${day(7, NOW)}T08:00:00`))
    expect(near.find((i) => i.source === 'VITA')?.patientNotified).toBe(true)
  })
})

describe('indicadores só com contagens (BR-CLN-29)', () => {
  /** Janela passada sem dados de demo: [-60, -50] dias. */
  const WINDOW = { from: day(-60, NOW), to: day(-50, NOW) }

  beforeEach(() => {
    const slot = (id: string, dayOffset: number, time: string, professionalId?: string, capacity = 1) =>
      db.slots.push({
        id,
        clinicId: 'cln_horizonte',
        kind: 'APPOINTMENT',
        capacity,
        specialty: 'Cardiologia',
        professionalId,
        startsAt: at(dayOffset, time, NOW),
        durationMinutes: 30,
      })
    slot('rs1', -55, '09:00', 'pro_ana')
    slot('rs2', -55, '09:30', 'pro_ana')
    slot('rs3', -54, '09:00', 'pro_ana')
    slot('rs4', -54, '10:00', 'pro_rui')
    slot('rs5', -54, '10:30', 'pro_rui')
    const patch = (slotId: string, dayOffset: number, time: string, status: Appointment['status'], extra: Partial<Appointment> = {}) =>
      addAppointment(dayOffset, time, { slotId, status, ...extra })
    patch('rs1', -55, '09:00', 'COMPLETED')
    patch('rs2', -55, '09:30', 'NO_SHOW')
    patch('rs3', -54, '09:00', 'CANCELLED', { confirmationStatus: 'DECLINED' })
    patch('rs4', -54, '10:00', 'COMPLETED')
    // Visita manual sem horário: conta em realizadas, não na ocupação.
    db.clinicVisits.push({
      id: 'vis_rep',
      clinicId: 'cln_horizonte',
      clinicPatientId: 'cpt_helena',
      scheduledAt: at(-54, '15:00', NOW),
      durationMinutes: 30,
      professionalId: 'pro_rui',
      status: 'COMPLETED',
    })
  })

  it('totais e por profissional: ocupação, realizadas, faltas, taxas, cancelamentos e "Não posso"', async () => {
    const report = await clinicDay.getClinicReportSummary(ADMIN, WINDOW, NOW)
    expect(report.totals).toMatchObject({
      slotsTotal: 5,
      slotsBooked: 3, // rs1, rs2, rs4 (rs3 cancelada liberta; rs5 livre)
      occupancyRate: 3 / 5,
      completed: 3,
      noShows: 1,
      noShowRate: 1 / 4,
      cancellations: 1,
      declinedByPatient: 1,
      newPatients: 4, // pacientes demo criados há 60 dias, dentro da janela
      examsCompleted: 0,
    })
    const ana = report.byProfessional.find((r) => r.professionalId === 'pro_ana')
    expect(ana).toMatchObject({
      professionalName: 'Dr.ª Ana Costa',
      slotsTotal: 3,
      slotsBooked: 2,
      completed: 1,
      noShows: 1,
      noShowRate: 0.5,
      cancellations: 1,
      declinedByPatient: 1,
    })
    const rui = report.byProfessional.find((r) => r.professionalId === 'pro_rui')
    expect(rui).toMatchObject({ slotsTotal: 2, slotsBooked: 1, completed: 2, noShows: 0, noShowRate: 0 })
    // Soma das linhas = totais.
    expect(report.byProfessional.reduce((n, r) => n + r.completed, 0)).toBe(report.totals.completed)
  })

  it('filtra por profissional (taxas nulas sem denominador) e não filtra novos pacientes', async () => {
    const report = await clinicDay.getClinicReportSummary(MANAGER, { ...WINDOW, professionalId: 'pro_ines' }, NOW)
    expect(report.byProfessional).toEqual([])
    expect(report.totals).toMatchObject({ slotsTotal: 0, occupancyRate: null, noShowRate: null, completed: 0 })
    const filtered = await clinicDay.getClinicReportSummary(MANAGER, { ...WINDOW, professionalId: 'pro_ana' }, NOW)
    expect(filtered.byProfessional.map((r) => r.professionalId)).toEqual(['pro_ana'])
    expect(filtered.totals).toMatchObject({ slotsTotal: 3, completed: 1 })
    // Pacientes criados na janela (da clínica inteira).
    const all = await clinicDay.getClinicReportSummary(ADMIN, { from: day(-61, NOW), to: day(-59, NOW) }, NOW)
    expect(all.totals.newPatients).toBe(4)
    const filteredPatients = await clinicDay.getClinicReportSummary(
      ADMIN,
      { from: day(-61, NOW), to: day(-59, NOW), professionalId: 'pro_ana' },
      NOW,
    )
    expect(filteredPatients.totals.newPatients).toBe(4)
  })

  it('devolve só números: nenhum nome de paciente nem id Vita', async () => {
    const report = await clinicDay.getClinicReportSummary(ADMIN, WINDOW, NOW)
    const text = JSON.stringify(report)
    for (const name of ['Maria', 'Monarca', 'Helena', 'Carlos', 'Pedro']) expect(text).not.toContain(name)
    expect(text).not.toMatch(/mem_|usr_|fam_|apt_|cpt_|vis_/)
    const numbers = (value: unknown): boolean =>
      typeof value === 'number' ||
      value === null ||
      typeof value === 'string' ||
      (typeof value === 'object' && Object.values(value as object).every(numbers))
    expect(numbers(report)).toBe(true)
    expect(Object.keys(report.totals).sort()).toEqual(
      [
        'cancellations',
        'completed',
        'declinedByPatient',
        'examsCompleted',
        'newPatients',
        'noShowRate',
        'noShows',
        'occupancyRate',
        'slotsBooked',
        'slotsTotal',
      ].sort(),
    )
  })

  it('valida a janela (to ≥ from, ≤ 366 dias) e o profissional', async () => {
    expect(await code(clinicDay.getClinicReportSummary(ADMIN, { from: WINDOW.to, to: WINDOW.from }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(clinicDay.getClinicReportSummary(ADMIN, { from: day(-400, NOW), to: day(0, NOW) }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(clinicDay.getClinicReportSummary(ADMIN, { from: day(-365, NOW), to: day(0, NOW) }, NOW))).toBe('OK')
    expect(await code(clinicDay.getClinicReportSummary(ADMIN, { ...WINDOW, professionalId: 'pro_inexistente' }, NOW))).toBe('NOT_FOUND')
  })
})

describe('isolamento por clínica', () => {
  it('outra clínica não vê nem altera as marcações da Horizonte (NOT_FOUND)', async () => {
    const today = addAppointment(0, '07:00')
    const future = addAppointment(1, '09:00')
    const done = addAppointment(-3, '09:00', { status: 'COMPLETED' })
    for (const call of [
      clinicDay.arriveClinicBooking(OTHER, today.id, NOW),
      clinicDay.startClinicBooking(OTHER, today.id, NOW),
      clinicDay.noShowClinicBooking(OTHER, today.id, NOW),
      clinicDay.confirmClinicBookingByPhone(OTHER, future.id, NOW),
      clinicDay.setClinicFollowUp(OTHER, done.id, { amount: 1, unit: 'MONTHS' }, NOW),
      clinicDay.clearClinicFollowUp(OTHER, done.id, NOW),
      clinicDay.arriveClinicBooking(OTHER, 'vis_helena_passada', NOW),
    ]) {
      expect(await code(call)).toBe('NOT_FOUND')
    }
  })

  it('os retornos e os indicadores da outra clínica não incluem a Horizonte; sem sessão não há acesso', async () => {
    const done = addAppointment(-3, '09:00', { status: 'COMPLETED' })
    await clinicDay.setClinicFollowUp(ADMIN, done.id, { amount: 2, unit: 'WEEKS' }, NOW)
    expect(await clinicDay.listClinicFollowUps(OTHER, undefined, NOW)).toEqual([])
    const report = await clinicDay.getClinicReportSummary(OTHER, { from: day(-30, NOW), to: day(0, NOW) }, NOW)
    expect(report.totals).toMatchObject({ completed: 0, noShows: 0, cancellations: 0, newPatients: 0 })
    // Profissional de outra clínica ⇒ NOT_FOUND.
    expect(await code(clinicDay.getClinicReportSummary(OTHER, { from: day(-30, NOW), to: day(0, NOW), professionalId: 'pro_ana' }, NOW))).toBe('NOT_FOUND')
    expect(await code(clinicDay.listClinicFollowUps('cac_inexistente', undefined, NOW))).toBe('INVALID_CREDENTIALS')
  })
})
