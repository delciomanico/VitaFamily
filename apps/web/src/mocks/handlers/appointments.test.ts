import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import { at } from '../time'
import * as apt from './appointments'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 4, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

const input = (days = 3): apt.NewAppointmentInput => ({
  memberId: 'mem_maria',
  scheduledAt: at(days, '10:30', NOW),
  specialty: 'Dermatologia',
  clinicId: 'cln_horizonte',
  professionalName: 'Dr.ª Inês Lima',
})

beforeEach(() => resetDb(NOW))

describe('consultas', () => {
  it('lista as consultas visíveis por ordem cronológica', async () => {
    const list = await apt.listAppointments(FAMILY, MONARCA)
    const times = list.map((i) => i.appointment.scheduledAt)
    expect(times).toEqual([...times].sort())
    expect(list.find((i) => i.appointment.id === 'apt_pediatria')?.memberName).toBe('Pedro Lopes')
  })

  it('marcar cria a consulta agendada, com o nome da clínica', async () => {
    const created = await apt.createAppointment(FAMILY, MONARCA, input(), NOW)
    expect(created).toMatchObject({ status: 'SCHEDULED', clinicName: 'Clínica Horizonte', specialty: 'Dermatologia' })
  })

  it('recusa datas passadas e clínicas de outra família', async () => {
    expect(await code(apt.createAppointment(FAMILY, MONARCA, input(-1), NOW))).toBe('VALIDATION_ERROR')
    expect(await code(apt.createAppointment(FAMILY, MONARCA, { ...input(), clinicId: 'cln_x' }, NOW))).toBe(
      'VALIDATION_ERROR',
    )
  })

  it('reagendar remove os lembretes ainda por disparar', async () => {
    db.alerts.push({
      id: 'alr_futuro',
      recipientUserId: MONARCA,
      familyId: FAMILY,
      memberId: 'mem_monarca',
      type: 'APPOINTMENT_REMINDER',
      sourceType: 'APPOINTMENT',
      sourceId: 'apt_cardio',
      triggerAt: at(1, '07:30', NOW),
    })
    await apt.updateAppointment(FAMILY, MONARCA, 'apt_cardio', { scheduledAt: at(2, '11:00', NOW) }, NOW)
    const alerts = db.alerts.filter((a) => a.sourceId === 'apt_cardio').map((a) => a.id)
    // O lembrete já disparado mantém-se; o futuro sai.
    expect(alerts).toEqual(['alr_cardio'])
  })

  it('cancela uma consulta futura, mas só regista desfecho depois da hora', async () => {
    expect(await code(apt.setAppointmentStatus(FAMILY, MONARCA, 'apt_cardio', 'COMPLETED', NOW))).toBe(
      'VALIDATION_ERROR',
    )
    expect((await apt.setAppointmentStatus(FAMILY, MONARCA, 'apt_cardio', 'CANCELLED', NOW)).status).toBe('CANCELLED')
    expect((await apt.setAppointmentStatus(FAMILY, MONARCA, 'apt_endocrino', 'NO_SHOW', NOW)).status).toBe('NO_SHOW')
    expect(await code(apt.setAppointmentStatus(FAMILY, MONARCA, 'apt_endocrino', 'COMPLETED', NOW))).toBe(
      'VALIDATION_ERROR',
    )
  })

  it('sem acesso responde NOT_FOUND', async () => {
    expect(await code(apt.getAppointment(FAMILY, 'usr_ninguem', 'apt_cardio'))).toBe('NOT_FOUND')
    expect(await code(apt.createAppointment('fam_outra', MONARCA, input(), NOW))).toBe('NOT_FOUND')
  })
})
