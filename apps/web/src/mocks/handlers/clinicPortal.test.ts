import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as portal from './clinicPortal'

const ADMIN = 'cac_horizonte_admin'
const MANAGER = 'cac_horizonte_rececao'
const NOW = new Date(2026, 10, 5, 8, 0)

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

/** Horário de consulta livre e futuro da Clínica Horizonte. */
function freeSlot() {
  return db.slots.find(
    (s) => s.clinicId === 'cln_horizonte' && s.kind === 'APPOINTMENT' && Date.parse(s.startsAt) > NOW.getTime(),
  )!
}

beforeEach(() => resetDb(NOW))

describe('marcação presencial (ADR-024)', () => {
  it('pesquisa por e-mail exato devolve só o nome de apresentação', async () => {
    const result = await portal.lookupClinicPatient(MANAGER, ' Ana@VitaFamily.app ')
    expect(Object.keys(result)).toEqual(['displayName'])
    expect(result.displayName).toMatch(/^\S+( \S\.)?$/)
  })

  it('e-mail inexistente, suspenso ou sem membro SELF dão a mesma resposta', async () => {
    const suspended = db.users.find((u) => u.email === 'ana@vitafamily.app')!
    suspended.status = 'SUSPENDED'
    expect(await code(portal.lookupClinicPatient(MANAGER, 'ana@vitafamily.app'))).toBe('NOT_FOUND')
    expect(await code(portal.lookupClinicPatient(MANAGER, 'ninguem@x.pt'))).toBe('NOT_FOUND')
    expect(await code(portal.lookupClinicPatient(MANAGER, 'ana'))).toBe('VALIDATION_ERROR')
    expect(await code(portal.lookupClinicPatient(MANAGER, 'ana@'))).toBe('VALIDATION_ERROR')
  })

  it('marca a consulta como SCHEDULED, ocupa o horário e aparece na agenda', async () => {
    const slot = freeSlot()
    const booking = await portal.createClinicWalkIn(MANAGER, { patientEmail: 'ana@vitafamily.app', slotId: slot.id, notes: ' dor ' }, NOW)
    expect(booking).toMatchObject({ status: 'SCHEDULED', notes: 'dor' })
    expect(Object.keys(booking)).not.toContain('memberId')
    expect((await portal.listClinicAgenda(ADMIN, NOW)).some((b) => b.id === booking.id)).toBe(true)
    expect(await code(portal.createClinicWalkIn(ADMIN, { patientEmail: 'demo@vitafamily.app', slotId: slot.id }, NOW))).toBe('CONFLICT')
  })

  it('recusa horário de outra clínica, passado ou de exame', async () => {
    const slot = freeSlot()
    const exam = db.slots.find((s) => s.clinicId === 'cln_horizonte' && s.kind === 'EXAM')!
    db.slots.push({ ...slot, id: 'slot_other', clinicId: 'cln_outra' })
    db.slots.push({ ...slot, id: 'slot_past', startsAt: new Date(NOW.getTime() - 3_600_000).toISOString() })
    const input = (slotId: string) => ({ patientEmail: 'ana@vitafamily.app', slotId })
    expect(await code(portal.createClinicWalkIn(MANAGER, input('slot_other'), NOW))).toBe('NOT_FOUND')
    expect(await code(portal.createClinicWalkIn(MANAGER, input('slot_past'), NOW))).toBe('CONFLICT')
    expect(await code(portal.createClinicWalkIn(MANAGER, input(exam.id), NOW))).toBe('VALIDATION_ERROR')
  })

  it('recusa sobreposição com outra consulta agendada do paciente', async () => {
    const slot = freeSlot()
    const ana = db.members.find((m) => m.userId === 'usr_ana')!
    db.appointments.push({
      id: 'apt_x',
      familyId: ana.familyId,
      memberId: ana.id,
      scheduledAt: slot.startsAt,
      status: 'SCHEDULED',
    })
    expect(await code(portal.createClinicWalkIn(MANAGER, { patientEmail: 'ana@vitafamily.app', slotId: slot.id }, NOW))).toBe('CONFLICT')
  })
})
