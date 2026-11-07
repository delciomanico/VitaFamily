import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { appointmentSlotTaken } from '../bookings'
import { db, resetDb } from '../db'
import * as consents from './clinicConsents'
import * as patients from './clinicPatients'
import * as portal from './clinicPortal'

const ADMIN = 'cac_horizonte_admin'
const MANAGER = 'cac_horizonte_rececao'
const OTHER = 'cac_vidaplena_admin'
const NOW = new Date(2026, 10, 5, 8, 0)
const FAMILY = 'fam_monarca'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

/** Horário de consulta livre e futuro da Clínica Horizonte (o n-ésimo, para escolher vários). */
const freeSlot = (n = 0) =>
  db.slots
    .filter(
      (s) =>
        s.clinicId === 'cln_horizonte' &&
        s.kind === 'APPOINTMENT' &&
        Date.parse(s.startsAt) > NOW.getTime() &&
        !appointmentSlotTaken(s.id),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[n]!

beforeEach(() => {
  resetDb(NOW)
  db.clinicAccounts.push({
    id: OTHER,
    clinicId: 'cln_vidaplena',
    email: 'admin@vidaplena.pt',
    password: 'x',
    role: 'CLINIC_ADMIN',
    status: 'ACTIVE',
  })
})

describe('pacientes da clínica (BR-CLN-17)', () => {
  it('dados demo: 4 pacientes, um ligado a um membro com HISTORY, sem ids Vita', async () => {
    const page = await patients.listClinicPatients(MANAGER, {}, NOW)
    expect(page.items.map((p) => p.name)).toEqual(['Carlos Mateus', 'Helena Baptista', 'Monarca Lopes', 'Pedro L.'])
    const linked = page.items.find((p) => p.name === 'Monarca Lopes')!
    expect(linked.vitaLink).toMatchObject({ via: 'EMAIL', consentLevel: 'HISTORY' })
    expect(JSON.stringify(page)).not.toMatch(/mem_|usr_|memberId/)
  })

  it('cria (origin MANUAL), edita, limpa campos e valida', async () => {
    const created = await patients.createClinicPatient(MANAGER, { name: '  Zé Silva ', phone: '+244 923 111 222', birthDate: '1990-01-01' }, NOW)
    expect(created).toMatchObject({ name: 'Zé Silva', origin: 'MANUAL', vitaLink: null, email: null })
    // Homónimos são válidos.
    await patients.createClinicPatient(ADMIN, { name: 'Zé Silva' }, NOW)
    const updated = await patients.updateClinicPatient(ADMIN, created.id, { phone: null, notes: ' nota ' }, NOW)
    expect(updated).toMatchObject({ phone: null, notes: 'nota', name: 'Zé Silva' })
    expect(await code(patients.createClinicPatient(MANAGER, { name: '' }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(patients.createClinicPatient(MANAGER, { name: 'X', birthDate: '2030-01-01' }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(patients.createClinicPatient(MANAGER, { name: 'X', email: 'mau' }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(patients.createClinicPatient(MANAGER, { name: 'X', phone: 'abc' }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(patients.updateClinicPatient(MANAGER, created.id, { name: null as unknown as string }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(patients.updateClinicPatient(MANAGER, created.id, {}, NOW))).toBe('VALIDATION_ERROR')
  })

  it('pesquisa por nome sem acentos/maiúsculas, e-mail e telefone; q curto é inválido', async () => {
    const names = async (q: string) => (await patients.listClinicPatients(MANAGER, { q }, NOW)).items.map((p) => p.name)
    expect(await names('LUISA')).toEqual([]) // outra clínica
    expect(await names('helena')).toEqual(['Helena Baptista'])
    expect(await names('mateus@EXEMPLO')).toEqual(['Carlos Mateus'])
    expect(await names('924 555')).toEqual(['Helena Baptista'])
    expect(await code(patients.listClinicPatients(MANAGER, { q: 'a' }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(patients.listClinicPatients(MANAGER, { q: '12' }, NOW))).toBe('OK') // ≥2 caracteres; telefone exige ≥3 dígitos
  })

  it('pagina por cursor', async () => {
    const first = await patients.listClinicPatients(MANAGER, { limit: 3 }, NOW)
    expect(first.items).toHaveLength(3)
    expect(first.nextCursor).not.toBeNull()
    const second = await patients.listClinicPatients(MANAGER, { limit: 3, cursor: first.nextCursor! }, NOW)
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
  })

  it('isolamento por clínica: id de outra clínica é NOT_FOUND em tudo', async () => {
    for (const run of [
      () => patients.getClinicPatient(OTHER, 'cpt_helena', NOW),
      () => patients.updateClinicPatient(OTHER, 'cpt_helena', { name: 'Y' }, NOW),
      () => patients.getClinicPatientRecord(OTHER, 'cpt_monarca', NOW),
      () => patients.getClinicSharedHistory(OTHER, 'cpt_monarca', NOW),
    ]) {
      expect(await code(run())).toBe('NOT_FOUND')
    }
    expect((await patients.listClinicPatients(OTHER, {}, NOW)).items.map((p) => p.name)).toEqual(['Luísa Fonseca'])
  })
})

describe('histórico partilhado (BR-CLN-21)', () => {
  it('com HISTORY válido devolve medicação ativa e exames', async () => {
    const history = await patients.getClinicSharedHistory(MANAGER, 'cpt_monarca', NOW)
    expect(history.active).toBe(true)
    expect(history.level).toBe('HISTORY')
    expect(history.medications.length).toBeGreaterThan(0)
    expect(history.examinations.length).toBeGreaterThan(0)
    expect(Object.keys(history.medications[0]!).sort()).toEqual(['continuous', 'dosage', 'endAt', 'name', 'startAt'])
  })

  it('sem consentimento HISTORY, expirado, revogado ou sem ligação: 200 com active=false e listas vazias', async () => {
    const inactive = { active: false, medications: [], examinations: [] }
    expect(await patients.getClinicSharedHistory(MANAGER, 'cpt_pedro', NOW)).toMatchObject(inactive) // BOOKINGS
    expect(await patients.getClinicSharedHistory(MANAGER, 'cpt_helena', NOW)).toMatchObject(inactive) // manual
    // Expirado: 13 meses depois passa a BOOKINGS.
    const later = new Date(2027, 11, 20)
    expect(await patients.getClinicSharedHistory(MANAGER, 'cpt_monarca', later)).toMatchObject(inactive)
    // Revogado pela família.
    await consents.revokeClinicConsent(FAMILY, 'usr_monarca', 'mem_monarca', 'cln_horizonte')
    expect(await patients.getClinicSharedHistory(MANAGER, 'cpt_monarca', NOW)).toMatchObject(inactive)
  })

  it('revogar desliga o paciente mas a clínica conserva o registo; ficha deixa de associar marcações Vita', async () => {
    const before = await patients.getClinicPatientRecord(MANAGER, 'cpt_monarca', NOW)
    expect(before.bookings.length).toBeGreaterThan(0)
    await consents.revokeClinicConsent(FAMILY, 'usr_monarca', 'mem_monarca', 'cln_horizonte')
    const after = await patients.getClinicPatient(MANAGER, 'cpt_monarca', NOW)
    expect(after).toMatchObject({ name: 'Monarca Lopes', vitaLink: null, origin: 'VITA' })
    expect((await patients.getClinicPatientRecord(MANAGER, 'cpt_monarca', NOW)).bookings).toHaveLength(0)
  })
})

describe('ligação por código (BR-CLN-20)', () => {
  it('cria paciente VITA com consentimento BOOKINGS e consome o código (uso único)', async () => {
    const { code: generated } = await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_maria', NOW)
    expect(generated).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    const patient = await patients.linkClinicPatient(MANAGER, { code: `${generated.slice(0, 4).toLowerCase()}-${generated.slice(4)}` }, NOW)
    expect(patient).toMatchObject({ origin: 'VITA', vitaLink: { via: 'CODE', consentLevel: 'BOOKINGS' } })
    expect(patient.name).toMatch(/^Maria L\./)
    const listed = await consents.listClinicConsents(FAMILY, 'usr_monarca', 'mem_maria', NOW)
    expect(listed).toEqual([expect.objectContaining({ clinicId: 'cln_horizonte', level: 'BOOKINGS', linked: true })])
    expect(await code(patients.linkClinicPatient(MANAGER, { code: generated }, NOW))).toBe('NOT_FOUND')
  })

  it('404 idêntico para inválido, expirado, usado e id de outra clínica; formato errado é 422', async () => {
    const { code: generated } = await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_maria', NOW)
    expect(await code(patients.linkClinicPatient(MANAGER, { code: 'AAAAAAAA' }, NOW))).toBe('NOT_FOUND')
    expect(await code(patients.linkClinicPatient(MANAGER, { code: generated }, new Date(NOW.getTime() + 11 * 60_000)))).toBe('NOT_FOUND')
    expect(await code(patients.linkClinicPatient(MANAGER, { code: generated, clinicPatientId: 'cpt_vp_luisa' }, NOW))).toBe('NOT_FOUND')
    expect(await code(patients.linkClinicPatient(MANAGER, { code: 'abc' }, NOW))).toBe('VALIDATION_ERROR')
  })

  it('liga um paciente existente; novo código invalida o anterior; conflitos', async () => {
    const first = await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_maria', NOW)
    const second = await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_maria', NOW)
    expect(await code(patients.linkClinicPatient(MANAGER, { code: first.code }, NOW))).toBe('NOT_FOUND')
    const linked = await patients.linkClinicPatient(MANAGER, { code: second.code, clinicPatientId: 'cpt_helena' }, NOW)
    expect(linked).toMatchObject({ id: 'cpt_helena', origin: 'MANUAL', vitaLink: { via: 'CODE' } })
    // O membro já está ligado a outro paciente da clínica; o paciente já está ligado a outra pessoa.
    const third = await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_maria', NOW)
    expect(await code(patients.linkClinicPatient(MANAGER, { code: third.code, clinicPatientId: 'cpt_carlos' }, NOW))).toBe('CONFLICT')
    const other = await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_joao', NOW)
    expect(await code(patients.linkClinicPatient(MANAGER, { code: other.code, clinicPatientId: 'cpt_helena' }, NOW))).toBe('CONFLICT')
    // Já ligado ao mesmo: idempotente.
    const again = await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_maria', NOW)
    expect((await patients.linkClinicPatient(MANAGER, { code: again.code }, NOW)).id).toBe('cpt_helena')
  })
})

describe('marcação presencial com paciente da clínica (BR-CLN-18)', () => {
  it('exatamente um de patientEmail e clinicPatientId', async () => {
    const slot = freeSlot()
    expect(await code(portal.createClinicWalkIn(MANAGER, { slotId: slot.id } as never, NOW))).toBe('VALIDATION_ERROR')
    expect(
      await code(portal.createClinicWalkIn(MANAGER, { slotId: slot.id, patientEmail: 'ana@vitafamily.app', clinicPatientId: 'cpt_helena' } as never, NOW)),
    ).toBe('VALIDATION_ERROR')
    expect(await code(portal.createClinicWalkIn(MANAGER, { slotId: slot.id, clinicPatientId: 'cpt_vp_luisa' }, NOW))).toBe('NOT_FOUND')
  })

  it('por e-mail cria o paciente VITA ligado, com consentimento BOOKINGS, e reutiliza-o', async () => {
    const one = await portal.createClinicWalkIn(MANAGER, { patientEmail: 'ana@vitafamily.app', slotId: freeSlot().id }, NOW)
    expect(one).toMatchObject({ source: 'VITA' })
    const created = db.clinicPatients.filter((p) => p.memberId === 'mem_ana' && p.clinicId === 'cln_horizonte')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ origin: 'VITA', linkVia: 'EMAIL' })
    expect(one.clinicPatientId).toBe(created[0]!.id)
    await portal.createClinicWalkIn(MANAGER, { patientEmail: 'ana@vitafamily.app', slotId: freeSlot().id }, NOW)
    expect(db.clinicPatients.filter((p) => p.memberId === 'mem_ana')).toHaveLength(1)
    expect(db.clinicConsents.find((c) => c.memberId === 'mem_ana')).toMatchObject({ level: 'BOOKINGS' })
  })

  it('por e-mail não baixa um HISTORY existente', async () => {
    await portal.createClinicWalkIn(MANAGER, { patientEmail: 'demo@vitafamily.app', slotId: freeSlot().id }, NOW)
    expect(db.clinicConsents.find((c) => c.memberId === 'mem_monarca')?.level).toBe('HISTORY')
  })

  it('paciente ligado: consulta no membro Vita', async () => {
    const booking = await portal.createClinicWalkIn(MANAGER, { clinicPatientId: 'cpt_pedro', slotId: freeSlot().id }, NOW)
    expect(booking).toMatchObject({ source: 'VITA', clinicPatientId: 'cpt_pedro', status: 'SCHEDULED' })
    expect(db.appointments.find((a) => a.id === booking.id)?.memberId).toBe('mem_pedro')
  })

  it('paciente manual: visita só da clínica, que ocupa o horário, aparece na agenda e na ficha', async () => {
    const slot = freeSlot()
    const visit = await portal.createClinicWalkIn(MANAGER, { clinicPatientId: 'cpt_helena', slotId: slot.id, notes: ' dor ' }, NOW)
    expect(visit).toMatchObject({ source: 'MANUAL', clinicPatientId: 'cpt_helena', status: 'SCHEDULED', patientName: 'Helena Baptista', notes: 'dor' })
    expect(db.appointments.some((a) => a.id === visit.id)).toBe(false)
    expect((await portal.listClinicAgenda(ADMIN, NOW)).find((b) => b.id === visit.id)?.source).toBe('MANUAL')
    expect((await patients.getClinicPatientRecord(ADMIN, 'cpt_helena', NOW)).bookings.map((b) => b.id)).toContain(visit.id)
    // Horário ocupado (também para a família) e remoção bloqueada.
    expect(await code(portal.createClinicWalkIn(MANAGER, { clinicPatientId: 'cpt_carlos', slotId: slot.id }, NOW))).toBe('CONFLICT')
    expect(await code(portal.removeClinicSlot(ADMIN, slot.id))).toBe('CONFLICT')
    expect((await portal.listOwnClinicSlots(ADMIN, 'APPOINTMENT', NOW)).find((s) => s.id === slot.id)?.state).toBe('SCHEDULED')
  })

  it('sobreposição de visitas do mesmo paciente é CONFLICT', async () => {
    const a = freeSlot(0)
    await portal.createClinicWalkIn(MANAGER, { clinicPatientId: 'cpt_helena', slotId: a.id }, NOW)
    db.slots.push({ ...a, id: 'slot_overlap', startsAt: new Date(Date.parse(a.startsAt) + 10 * 60_000).toISOString() })
    expect(await code(portal.createClinicWalkIn(MANAGER, { clinicPatientId: 'cpt_helena', slotId: 'slot_overlap' }, NOW))).toBe('CONFLICT')
  })

  it('cancelar (com motivo) e completar visita manual pelos endpoints da agenda; sem receita', async () => {
    const slot = freeSlot(0)
    const slot2 = freeSlot(1)
    const v1 = await portal.createClinicWalkIn(MANAGER, { clinicPatientId: 'cpt_carlos', slotId: slot.id }, NOW)
    expect(await code(portal.cancelClinicAppointment(MANAGER, v1.id, ' ', NOW))).toBe('VALIDATION_ERROR')
    expect(await portal.cancelClinicAppointment(MANAGER, v1.id, 'Faltou o médico', NOW)).toMatchObject({ status: 'CANCELLED', source: 'MANUAL' })
    const v2 = await portal.createClinicWalkIn(MANAGER, { clinicPatientId: 'cpt_carlos', slotId: slot2.id }, NOW)
    const rx = { issuedOn: '2026-11-05', medications: [{ name: 'X', dosage: '1', times: ['08:00'] }] }
    expect(await code(portal.completeClinicAppointment(MANAGER, v2.id, { prescription: rx }, NOW))).toBe('VALIDATION_ERROR')
    expect(await portal.completeClinicAppointment(MANAGER, v2.id, { outcomeNote: 'ok' }, NOW)).toMatchObject({ status: 'COMPLETED' })
    expect(await code(portal.completeClinicAppointment(MANAGER, v2.id, {}, NOW))).toBe('CONFLICT')
    // Horário libertado pela visita cancelada.
    expect(await code(portal.createClinicWalkIn(MANAGER, { clinicPatientId: 'cpt_helena', slotId: slot.id }, NOW))).toBe('OK')
  })
})

describe('pesquisa global e calendário (BR-CLN-22/23)', () => {
  it('devolve pacientes e marcações da própria clínica; nunca a base Vita', async () => {
    const result = await patients.clinicGlobalSearch(MANAGER, 'monarca', NOW)
    expect(result.patients.map((p) => p.name)).toEqual(['Monarca Lopes'])
    expect(result.bookings.length).toBeGreaterThan(0)
    expect(result.bookings.every((b) => b.patientName === 'Monarca Lopes')).toBe(true)
    // Pesquisa por serviço/especialidade e por profissional.
    expect((await patients.clinicGlobalSearch(MANAGER, 'cardiologia', NOW)).bookings.length).toBeGreaterThan(0)
    expect((await patients.clinicGlobalSearch(MANAGER, 'ana costa', NOW)).bookings.length).toBeGreaterThan(0)
    // Ana (conta Vita sem registo da clínica) não aparece.
    expect((await patients.clinicGlobalSearch(MANAGER, 'ana lopes', NOW)).patients).toEqual([])
    expect(await code(patients.clinicGlobalSearch(MANAGER, 'm', NOW))).toBe('VALIDATION_ERROR')
    expect(await code(patients.clinicGlobalSearch(MANAGER, '', NOW))).toBe('VALIDATION_ERROR')
    expect((await patients.clinicGlobalSearch(OTHER, 'monarca', NOW)).patients).toEqual([])
  })

  it('futuras primeiro e no máximo 10', async () => {
    for (let i = 0; i < 12; i++) {
      await patients.createClinicPatient(MANAGER, { name: `Teste ${i}` }, NOW)
    }
    expect((await patients.clinicGlobalSearch(MANAGER, 'teste', NOW)).patients).toHaveLength(10)
    const { bookings } = await patients.clinicGlobalSearch(MANAGER, 'lopes', NOW)
    const firstPast = bookings.findIndex((b) => Date.parse(b.startsAt) < NOW.getTime())
    if (firstPast >= 0) expect(bookings.slice(firstPast).every((b) => Date.parse(b.startsAt) < NOW.getTime())).toBe(true)
  })

  it('calendário: entradas (consultas, exames, visitas), horários livres, filtro por profissional e validações', async () => {
    const from = new Date(2026, 10, 1).toISOString()
    const to = new Date(2026, 10, 30).toISOString()
    const visitSlot = freeSlot()
    const visit = await portal.createClinicWalkIn(MANAGER, { clinicPatientId: 'cpt_helena', slotId: visitSlot.id }, NOW)
    const all = await patients.getClinicCalendar(MANAGER, { from, to }, NOW)
    expect(all.entries.some((e) => e.id === visit.id && e.source === 'MANUAL')).toBe(true)
    expect(all.entries.every((e) => Date.parse(e.endsAt) > Date.parse(e.startsAt))).toBe(true)
    expect(all.freeSlots.every((s) => s.remaining >= 1 && Date.parse(s.startsAt) > NOW.getTime())).toBe(true)
    expect(all.freeSlots.some((s) => s.slotId === visitSlot.id)).toBe(false)
    const filtered = await patients.getClinicCalendar(MANAGER, { from, to, professionalId: 'pro_ana' }, NOW)
    expect(filtered.freeSlots.every((s) => s.professionalId === 'pro_ana')).toBe(true)
    expect(filtered.entries.every((e) => e.professionalId === 'pro_ana')).toBe(true)
    expect(await code(patients.getClinicCalendar(OTHER, { from, to, professionalId: 'pro_ana' }, NOW))).toBe('NOT_FOUND')
    expect(await code(patients.getClinicCalendar(MANAGER, { from: to, to: from }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(patients.getClinicCalendar(MANAGER, { from, to: new Date(2026, 11, 20).toISOString() }, NOW))).toBe('VALIDATION_ERROR')
  })
})
