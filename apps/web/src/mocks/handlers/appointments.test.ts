import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { resetDb } from '../db'
import { at } from '../time'
import * as apt from './appointments'
import * as portal from './clinicPortal'

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
  clinicId: 'cln_bairro',
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

  it('registo direto (clínica privada) cria a consulta já agendada', async () => {
    const created = await apt.createAppointment(FAMILY, MONARCA, input(), NOW)
    expect(created).toMatchObject({ status: 'SCHEDULED', clinicName: 'Centro de Saúde do Bairro' })
  })

  it('clínica parceira não aceita registo direto, só pedido num horário (BR-APT-04)', async () => {
    expect(await code(apt.createAppointment(FAMILY, MONARCA, { ...input(), clinicId: 'cln_horizonte' }, NOW))).toBe(
      'VALIDATION_ERROR',
    )
  })

  it('recusa datas passadas e clínicas de outra família', async () => {
    expect(await code(apt.createAppointment(FAMILY, MONARCA, input(-1), NOW))).toBe('VALIDATION_ERROR')
    expect(await code(apt.createAppointment(FAMILY, MONARCA, { ...input(), clinicId: 'cln_x' }, NOW))).toBe(
      'VALIDATION_ERROR',
    )
  })

  it('consultas de clínica parceira não se reagendam (BR-APT-09)', async () => {
    // As de clínica parceira não se reagendam: cancela-se e pede-se outro horário (BR-APT-09).
    expect(
      await code(apt.updateAppointment(FAMILY, MONARCA, 'apt_cardio', { scheduledAt: at(2, '11:00', NOW) }, NOW)),
    ).toBe('VALIDATION_ERROR')
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

describe('marcação com a clínica parceira (D17)', () => {
  it('lista só horários livres e futuros da especialidade', async () => {
    const slots = await apt.listAvailableSlots(FAMILY, 'dermatologia', NOW)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((s) => s.specialty === 'Dermatologia' && Date.parse(s.startsAt) > NOW.getTime())).toBe(true)
    // O horário pedido pela Maria já não aparece.
    expect(slots.some((s) => s.id === 'slot_3_1100_derm')).toBe(false)
  })

  it('pedido fica a aguardar; horário ocupado responde CONFLICT', async () => {
    const [slot] = await apt.listAvailableSlots(FAMILY, 'Pediatria', NOW)
    const request = { memberId: 'mem_pedro', slotId: slot!.id }
    const created = await apt.requestAppointment(FAMILY, MONARCA, request, NOW)
    expect(created).toMatchObject({
      status: 'REQUESTED',
      clinicName: 'Clínica Horizonte',
      professionalName: 'Dr. Rui Mendes',
    })
    expect(await code(apt.requestAppointment(FAMILY, MONARCA, request, NOW))).toBe('CONFLICT')
  })

  it('a clínica confirma ou recusa; recusar liberta o horário', async () => {
    expect((await portal.confirmBooking('usr_clinica', 'apt_derma', NOW)).status).toBe('SCHEDULED')
    expect(await code(portal.rejectBooking('usr_clinica', 'apt_derma', 'x', NOW))).toBe('CONFLICT')

    const [slot] = await apt.listAvailableSlots(FAMILY, 'Cardiologia', NOW)
    const req = await apt.requestAppointment(FAMILY, MONARCA, { memberId: 'mem_monarca', slotId: slot!.id }, NOW)
    const rejected = await portal.rejectBooking('usr_clinica', req.id, 'Médica ausente', NOW)
    expect(rejected).toMatchObject({ status: 'REJECTED', responseNote: 'Médica ausente' })
    expect((await apt.listAvailableSlots(FAMILY, 'Cardiologia', NOW)).some((s) => s.id === slot!.id)).toBe(true)
  })

  it('a clínica só vê dados mínimos das suas marcações', async () => {
    const bookings = await portal.listClinicBookings('usr_clinica', NOW)
    const derma = bookings.find((b) => b.id === 'apt_derma')!
    expect(derma).toMatchObject({ patientName: 'Maria Lopes', status: 'REQUESTED' })
    expect(Object.keys(derma)).not.toContain('memberId')
    expect(Object.keys(derma)).not.toContain('familyId')
    // Consultas de clínicas privadas não aparecem.
    expect(bookings.some((b) => b.id === 'apt_endocrino')).toBe(false)
  })

  it('quem não é Gestor recebe FORBIDDEN', async () => {
    expect(await code(portal.listClinicBookings(MONARCA, NOW))).toBe('FORBIDDEN')
  })

  it('pedido sem resposta até à hora passa a cancelado', async () => {
    const later = new Date(NOW.getTime() + 4 * 86_400_000)
    const item = await apt.getAppointment(FAMILY, MONARCA, 'apt_derma', later)
    expect(item.appointment.status).toBe('CANCELLED')
  })

  it('publica horários (ignorando os passados) e só remove os livres', async () => {
    const created = await portal.publishSlots(
      'usr_clinica',
      { date: '2026-10-04', times: ['09:00', '18:00'], specialty: 'Ortopedia', durationMinutes: 30 },
      NOW,
    )
    expect(created).toHaveLength(1)
    await portal.removeSlot('usr_clinica', created[0]!.id)
    expect(await code(portal.removeSlot('usr_clinica', 'slot_1_0930_card'))).toBe('CONFLICT')
  })
})
