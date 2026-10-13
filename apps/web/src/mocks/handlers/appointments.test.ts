import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import { DEMO_CLINIC_ADMIN_EMAIL } from '../data/clinicAccounts'
import { at } from '../time'
import * as apt from './appointments'
import * as portal from './clinicPortal'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 4, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
/** Conta do portal da clínica (`ClinicAccount`), nunca um `User` (ADR-020). */
const ADMIN = 'cac_horizonte_admin'
const ADMIN_EMAIL = DEMO_CLINIC_ADMIN_EMAIL

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
    expect((await portal.respondClinicRequest(ADMIN, 'apt_derma', 'CONFIRM', undefined, NOW)).status).toBe('SCHEDULED')
    expect(await code(portal.respondClinicRequest(ADMIN, 'apt_derma', 'REJECT', 'x', NOW))).toBe('CONFLICT')

    const [slot] = await apt.listAvailableSlots(FAMILY, 'Cardiologia', NOW)
    const req = await apt.requestAppointment(FAMILY, MONARCA, { memberId: 'mem_monarca', slotId: slot!.id }, NOW)
    const rejected = await portal.respondClinicRequest(ADMIN, req.id, 'REJECT', 'Médica ausente', NOW)
    expect(rejected).toMatchObject({ status: 'REJECTED', responseNote: 'Médica ausente' })
    expect((await apt.listAvailableSlots(FAMILY, 'Cardiologia', NOW)).some((s) => s.id === slot!.id)).toBe(true)
  })

  it('a clínica só vê dados mínimos das suas marcações', async () => {
    const requests = await portal.listClinicRequests(ADMIN, NOW)
    const derma = requests.find((b) => b.id === 'apt_derma')!
    expect(derma).toMatchObject({ patientName: 'Maria Lopes', status: 'REQUESTED' })
    expect(Object.keys(derma)).not.toContain('memberId')
    expect(Object.keys(derma)).not.toContain('familyId')
    // Consultas de clínicas privadas não aparecem na agenda desta clínica.
    expect((await portal.listClinicAgenda(ADMIN, NOW)).some((b) => b.id === 'apt_endocrino')).toBe(false)
  })

  it('pedido sem resposta até à hora passa a cancelado', async () => {
    const later = new Date(NOW.getTime() + 4 * 86_400_000)
    const item = await apt.getAppointment(FAMILY, MONARCA, 'apt_derma', later)
    expect(item.appointment.status).toBe('CANCELLED')
  })

  it('publica horários (ignorando os passados) e só remove os livres', async () => {
    const created = await portal.publishClinicSlots(
      ADMIN,
      { date: '2026-10-04', times: ['09:00', '18:00'], specialty: 'Ortopedia', durationMinutes: 30 },
      NOW,
    )
    expect(created).toHaveLength(1)
    await portal.removeClinicSlot(ADMIN, created[0]!.id)
    expect(await code(portal.removeClinicSlot(ADMIN, 'slot_1_0930_card'))).toBe('CONFLICT')
  })
})

describe('contas e sessões do portal da clínica (D18, ADR-020)', () => {
  it('entra com a conta da clínica, que não é um User da app', async () => {
    const session = await portal.clinicLogin(ADMIN_EMAIL, 'password')
    expect(session).toMatchObject({ clinicAccountId: ADMIN, clinicId: 'cln_horizonte', role: 'CLINIC_ADMIN' })
    // A mesma credencial não existe no espaço de identidade de `User` (e vice-versa).
    expect(db.users.some((u) => u.email === ADMIN_EMAIL)).toBe(false)
    expect(await code(portal.clinicLogin('demo@vitafamily.app', 'password'))).toBe('INVALID_CREDENTIALS')
  })

  it('só o Admin da clínica gere os Gestores (BR-CLN-05)', async () => {
    const manager = (await portal.listClinicStaff(ADMIN))[0]!
    expect(manager.role).toBe('CLINIC_MANAGER')
    // O Gestor não gere contas.
    expect(await code(portal.listClinicStaff(manager.id))).toBe('FORBIDDEN')

    const created = await portal.createClinicStaff(ADMIN, 'Nova@clinicahorizonte.pt')
    expect(created).toMatchObject({ clinicId: 'cln_horizonte', role: 'CLINIC_MANAGER', email: 'nova@clinicahorizonte.pt' })
    await portal.removeClinicStaff(ADMIN, created.id)
    expect((await portal.listClinicStaff(ADMIN)).some((a) => a.id === created.id)).toBe(false)
    // A conta de Admin raiz nunca é removida pelo portal (só o Platform Admin a repõe).
    expect(await code(portal.removeClinicStaff(ADMIN, ADMIN))).toBe('NOT_FOUND')
  })

  it('completar a consulta regista o desfecho e emite a receita ao paciente (BR-CLN-06/BR-RX-07)', async () => {
    await portal.respondClinicRequest(ADMIN, 'apt_derma', 'CONFIRM', undefined, NOW)
    const completed = await portal.completeClinicAppointment(
      ADMIN,
      'apt_derma',
      {
        outcomeNote: 'Dermatite de contacto.',
        prescription: {
          issuedOn: '2026-10-04',
          doctorName: 'Dr.ª Inês Lima',
          medications: [{ name: 'Hidrocortisona', dosage: '1%', times: ['09:00'], durationDays: 7 }],
        },
      },
      NOW,
    )
    expect(completed.status).toBe('COMPLETED')
    // A receita aparece nas receitas do paciente, marcada como emitida pela clínica.
    const issued = db.prescriptions.find((p) => p.appointmentId === 'apt_derma')!
    expect(issued).toMatchObject({ issuedBy: 'CLINIC', memberId: 'mem_maria' })
    // Nunca duas vezes a mesma conclusão (ST4).
    expect(await code(portal.completeClinicAppointment(ADMIN, 'apt_derma', {}, NOW))).toBe('CONFLICT')
  })
})
