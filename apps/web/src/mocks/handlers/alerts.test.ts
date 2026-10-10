import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import { at } from '../time'
import * as alerts from './alerts'
import * as apt from './appointments'
import * as portal from './clinicPortal'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 4, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const ANA = 'usr_ana'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

/** Instante a `minutes` minutos de NOW. */
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

const rulesFor = async (sourceId: string, now = NOW, userId = MONARCA) =>
  (await alerts.listAlerts(FAMILY, userId, now)).filter((a) => a.sourceId === sourceId).map((a) => a.ruleKey)

beforeEach(() => resetDb(NOW))

describe('centro de alertas', () => {
  it('mostra os não lidos primeiro e, dentro de cada grupo, os mais recentes', async () => {
    const list = await alerts.listAlerts(FAMILY, MONARCA, NOW)
    const firstRead = list.findIndex((a) => a.readAt)
    expect(firstRead).toBeGreaterThan(0)
    expect(list.slice(firstRead).every((a) => a.readAt)).toBe(true)
    const unread = list.slice(0, firstRead).map((a) => a.triggerAt)
    expect(unread).toEqual([...unread].sort().reverse())
  })

  it('marca um alerta e todos como lidos', async () => {
    const before = await alerts.countUnread(FAMILY, MONARCA, NOW)
    const [first] = await alerts.listAlerts(FAMILY, MONARCA, NOW)
    await alerts.markAlertRead(FAMILY, MONARCA, first!.id, NOW)
    expect(await alerts.countUnread(FAMILY, MONARCA, NOW)).toBe(before - 1)
    await alerts.markAllAlertsRead(FAMILY, MONARCA, NOW)
    expect(await alerts.countUnread(FAMILY, MONARCA, NOW)).toBe(0)
  })

  it('cada um só vê e marca os seus alertas (FR-ALR-08)', async () => {
    const [mine] = await alerts.listAlerts(FAMILY, MONARCA, NOW)
    expect(await code(alerts.markAlertRead(FAMILY, ANA, mine!.id, NOW))).toBe('NOT_FOUND')
    // Ana tem conta própria: os lembretes da consulta dela são só para ela.
    const beforeAna = at(8, '17:30', NOW)
    expect(await rulesFor('apt_ana', new Date(beforeAna), ANA)).toEqual(['appointment.24h'])
    expect(await rulesFor('apt_ana', new Date(beforeAna), MONARCA)).toEqual([])
  })
})

describe('regras (UC-ALR-01)', () => {
  it('são idempotentes: no máximo um alerta por evento, regra e destinatário', async () => {
    const count = db.alerts.length
    await alerts.listAlerts(FAMILY, MONARCA, NOW)
    await alerts.listAlerts(FAMILY, MONARCA, NOW)
    expect(db.alerts.length).toBe(count)
  })

  it('a toma repete uma vez 15 min depois, só se não for confirmada (BR-ALR-03)', async () => {
    // Metformina das 08:00 ficou por confirmar; Amoxicilina das 08:00 foi tomada.
    expect(await rulesFor('dose_med_metformina_0800')).toEqual(['dose.repeat', 'dose.due'])
    expect(await rulesFor('dose_med_amox_0800')).toEqual(['dose.due'])

    const dose = db.doses.find((d) => d.id === 'dose_med_metformina_2000')!
    expect(await rulesFor(dose.id, new Date(at(0, '20:05', NOW)))).toEqual(['dose.due'])
    dose.status = 'TAKEN'
    expect(await rulesFor(dose.id, new Date(at(0, '20:30', NOW)))).toEqual(['dose.due'])
  })

  it('a consulta tem lembretes 24 h e 2 h antes; marcada à última hora só recebe o mais próximo', async () => {
    expect(await rulesFor('apt_cardio')).toEqual(['appointment.24h'])
    expect(await rulesFor('apt_cardio', new Date(at(1, '08:00', NOW)))).toEqual(['appointment.2h', 'appointment.24h'])

    const soon = await apt.createAppointment(
      FAMILY,
      MONARCA,
      { memberId: 'mem_maria', scheduledAt: later(90).toISOString(), clinicId: 'cln_bairro' },
      NOW,
    )
    expect(await rulesFor(soon.id)).toEqual(['appointment.2h'])
  })

  it('reagendar recalcula os lembretes para a nova data', async () => {
    const direct = await apt.createAppointment(
      FAMILY,
      MONARCA,
      { memberId: 'mem_maria', scheduledAt: at(1, '10:00', NOW), clinicId: 'cln_bairro' },
      NOW,
    )
    expect(await rulesFor(direct.id)).toEqual(['appointment.24h'])
    await apt.updateAppointment(FAMILY, MONARCA, direct.id, { scheduledAt: at(1, '18:00', NOW) }, NOW)
    expect(await rulesFor(direct.id)).toEqual(['appointment.24h'])
    expect(await rulesFor(direct.id, new Date(at(0, '18:00', NOW)))).toEqual(['appointment.24h', 'appointment.24h'])
  })

  it('cancelar ou registar o desfecho deixa de gerar alertas da consulta', async () => {
    await apt.setAppointmentStatus(FAMILY, MONARCA, 'apt_cardio', 'CANCELLED', NOW)
    expect(await rulesFor('apt_cardio', new Date(at(1, '08:00', NOW)))).toEqual(['appointment.24h'])
    await apt.setAppointmentStatus(FAMILY, MONARCA, 'apt_endocrino', 'COMPLETED', NOW)
    expect(await rulesFor('apt_endocrino', later(60))).toEqual(['appointment.outcome'])
  })

  it('pede o desfecho da consulta passada que continua agendada (Q4)', async () => {
    const [outcome] = (await alerts.listAlerts(FAMILY, MONARCA, NOW)).filter((a) => a.sourceId === 'apt_endocrino')
    expect(outcome).toMatchObject({ type: 'APPOINTMENT_OUTCOME_REQUEST', memberName: 'João Lopes' })
  })

  it('lembra o exame agendado no dia anterior (24 h)', async () => {
    expect(await rulesFor('exm_pedro')).toEqual(['exam.24h'])
    expect(await rulesFor('exm_maria')).toEqual([])
  })
})

describe('respostas da clínica parceira (FR-APT-07)', () => {
  it('avisa o tutor quando a clínica confirma, recusa ou cancela', async () => {
    await portal.confirmBooking('usr_clinica', 'apt_derma', NOW)
    expect(await rulesFor('apt_derma')).toEqual(['appointment.confirmed'])

    await portal.cancelBooking('usr_clinica', 'apt_derma', 'Médica indisponível.', later(5))
    expect(await rulesFor('apt_derma', later(5))).toEqual(['appointment.cancelled', 'appointment.confirmed'])
    const [cancelled] = await alerts.listAlerts(FAMILY, MONARCA, later(5))
    expect(cancelled).toMatchObject({ type: 'APPOINTMENT_CANCELLED', memberName: 'Maria Lopes' })
  })

  it('avisa a recusa e o pedido sem resposta até à hora (BR-APT-08)', async () => {
    const slot = db.slots.find((s) => !db.appointments.some((a) => a.slotId === s.id))!
    const requested = await apt.requestAppointment(FAMILY, MONARCA, { memberId: 'mem_pedro', slotId: slot.id }, NOW)
    await portal.rejectBooking('usr_clinica', requested.id, undefined, NOW)
    expect(await rulesFor(requested.id)).toEqual(['appointment.rejected'])

    const afterDerma = new Date(Date.parse(at(3, '11:00', NOW)) + 60_000)
    expect(await rulesFor('apt_derma', afterDerma)).toEqual(['appointment.cancelled'])
  })
})
