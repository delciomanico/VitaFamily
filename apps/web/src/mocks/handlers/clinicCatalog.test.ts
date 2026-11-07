import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as catalog from './clinicCatalog'
import * as portal from './clinicPortal'

const ADMIN = 'cac_horizonte_admin'
const MANAGER = 'cac_horizonte_rececao'
const OTHER = 'cac_vidaplena_admin'
/** Quinta-feira, 08:00 locais. */
const NOW = new Date(2026, 10, 5, 8, 0)

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

const ruleSlots = (ruleId: string) => db.slots.filter((s) => s.scheduleRuleId === ruleId)
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)

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

const newRule = (overrides: Record<string, unknown> = {}) => ({
  professionalId: 'pro_rui',
  serviceTypeId: 'svc_pedia',
  weekdays: [1, 3],
  startTime: '09:00',
  endTime: '11:15',
  ...overrides,
})

describe('catálogo: profissionais e serviços', () => {
  it('dados demo da Clínica Horizonte', async () => {
    expect((await catalog.listClinicProfessionals(ADMIN)).length).toBeGreaterThanOrEqual(2)
    const services = await catalog.listClinicServices(MANAGER)
    expect(services.length).toBeGreaterThanOrEqual(4)
    expect(services.every((s) => s.currency === 'AOA')).toBe(true)
    expect(Number.isInteger(services[0]!.priceMinor ?? 0)).toBe(true)
  })

  it('cria, edita e desativa (Admin e Gestor); nome único entre ativos', async () => {
    const created = await catalog.createClinicProfessional(MANAGER, { name: ' Dr. Novo ', specialty: 'Ortopedia' })
    expect(created).toMatchObject({ name: 'Dr. Novo', active: true })
    expect(await code(catalog.createClinicProfessional(ADMIN, { name: 'dr. novo' }))).toBe('CONFLICT')
    expect(await code(catalog.createClinicProfessional(ADMIN, { name: '' }))).toBe('VALIDATION_ERROR')
    await catalog.updateClinicProfessional(ADMIN, created.id, { active: false })
    expect((await catalog.listClinicProfessionals(ADMIN, { active: true })).some((p) => p.id === created.id)).toBe(false)
    // Inativo não bloqueia o nome.
    await catalog.createClinicProfessional(ADMIN, { name: 'Dr. Novo' })
    expect(await code(catalog.updateClinicProfessional(ADMIN, created.id, { active: true }))).toBe('CONFLICT')
  })

  it('serviço: validações, kind imutável e preço em cêntimos', async () => {
    const svc = await catalog.createClinicService(ADMIN, { name: 'Raio-X', kind: 'EXAM', durationMinutes: 15, priceMinor: 500000 })
    expect(svc.priceMinor).toBe(500000)
    expect(await code(catalog.createClinicService(ADMIN, { name: 'raio-x', kind: 'EXAM', durationMinutes: 15 }))).toBe('CONFLICT')
    // Mesmo nome noutro kind é válido.
    expect(await code(catalog.createClinicService(ADMIN, { name: 'Raio-X', kind: 'APPOINTMENT', durationMinutes: 30 }))).toBe('OK')
    expect(await code(catalog.createClinicService(ADMIN, { name: 'X', kind: 'EXAM', durationMinutes: 25 }))).toBe('VALIDATION_ERROR')
    expect(await code(catalog.createClinicService(ADMIN, { name: 'Y', kind: 'EXAM', durationMinutes: 15, priceMinor: 1.5 }))).toBe('VALIDATION_ERROR')
    expect(await code(catalog.updateClinicService(ADMIN, svc.id, { kind: 'APPOINTMENT' } as never))).toBe('VALIDATION_ERROR')
    expect((await catalog.updateClinicService(ADMIN, svc.id, { priceMinor: null })).priceMinor).toBeUndefined()
  })

  it('isolamento por clínica', async () => {
    expect(await catalog.listClinicProfessionals(OTHER)).toEqual([])
    expect(await catalog.listClinicServices(OTHER)).toEqual([])
    expect(await code(catalog.updateClinicProfessional(OTHER, 'pro_ana', { active: false }))).toBe('NOT_FOUND')
    expect(await code(catalog.updateClinicService(OTHER, 'svc_cardio', { name: 'x' }))).toBe('NOT_FOUND')
    expect(await code(catalog.regenerateClinicScheduleRule(OTHER, 'rul_cardio_tarde'))).toBe('NOT_FOUND')
    expect(await code(catalog.createClinicScheduleRule(OTHER, newRule()))).toBe('NOT_FOUND')
    expect(await catalog.listClinicScheduleRules(OTHER)).toEqual([])
  })
})

describe('regras de horário e geração', () => {
  it('a regra demo já gerou horários e regenerar é idempotente', async () => {
    const before = ruleSlots('rul_cardio_tarde').length
    expect(before).toBeGreaterThan(30)
    const { generation } = await catalog.regenerateClinicScheduleRule(MANAGER, 'rul_cardio_tarde', NOW)
    expect(generation).toMatchObject({ created: 0, removed: 0 })
    expect(generation.unchanged).toBe(before)
    expect(ruleSlots('rul_cardio_tarde')).toHaveLength(before)
  })

  it('gera consecutivos com a duração do serviço, na janela de 8 semanas', async () => {
    const { rule, generation } = await catalog.createClinicScheduleRule(ADMIN, newRule(), NOW)
    // 45 min em 09:00–11:15 → 3 horários (09:00, 09:45, 10:30).
    const slots = ruleSlots(rule.id)
    const times = new Set(slots.map((s) => hhmm(s.startsAt)))
    expect([...times].sort()).toEqual(['09:00', '09:45', '10:30'])
    expect(slots.every((s) => s.durationMinutes === 45 && s.professionalId === 'pro_rui' && s.serviceTypeId === 'svc_pedia')).toBe(true)
    expect(slots.every((s) => s.kind === 'APPOINTMENT' && s.specialty === 'Consulta de pediatria')).toBe(true)
    // Segundas e quartas dentro de hoje..+56 dias (8 de cada) × 3.
    expect(generation.created).toBe(slots.length)
    expect(slots.length).toBe(48)
    const limit = NOW.getTime() + 57 * 86_400_000
    expect(slots.every((s) => Date.parse(s.startsAt) < limit)).toBe(true)
    // Idempotente.
    expect((await catalog.regenerateClinicScheduleRule(ADMIN, rule.id, NOW)).generation.created).toBe(0)
  })

  it('validade, capacidade e validações', async () => {
    const { rule } = await catalog.createClinicScheduleRule(ADMIN, newRule({ validUntil: '2026-11-12' }), NOW)
    // Quarta 11/11 (09:00, 09:45, 10:30); segunda 9/11 também (3) → 6.
    expect(ruleSlots(rule.id)).toHaveLength(6)
    expect(await code(catalog.createClinicScheduleRule(ADMIN, newRule({ professionalId: 'pro_ana', serviceTypeId: 'svc_pedia', startTime: '09:00', endTime: '09:30' }), NOW))).toBe('VALIDATION_ERROR')
    expect(await code(catalog.createClinicScheduleRule(ADMIN, newRule({ professionalId: 'pro_ines', weekdays: [] }), NOW))).toBe('VALIDATION_ERROR')
    expect(await code(catalog.createClinicScheduleRule(ADMIN, newRule({ professionalId: 'pro_ines', capacity: 3 }), NOW))).toBe('VALIDATION_ERROR')
    const exam = await catalog.createClinicScheduleRule(ADMIN, newRule({ professionalId: 'pro_ines', serviceTypeId: 'svc_analises', capacity: 4 }), NOW)
    expect(ruleSlots(exam.rule.id).every((s) => s.kind === 'EXAM' && s.capacity === 4)).toBe(true)
  })

  it('duas regras ativas do mesmo profissional não se sobrepõem', async () => {
    await catalog.createClinicScheduleRule(ADMIN, newRule(), NOW)
    expect(await code(catalog.createClinicScheduleRule(ADMIN, newRule({ weekdays: [3], startTime: '10:00', endTime: '12:00' }), NOW))).toBe('CONFLICT')
    expect(await code(catalog.createClinicScheduleRule(ADMIN, newRule({ weekdays: [2], startTime: '10:00', endTime: '12:00' }), NOW))).toBe('OK')
  })

  it('ignora horários sobrepostos do profissional e conta-os', async () => {
    db.slots.push({
      id: 'slot_manual', clinicId: 'cln_horizonte', kind: 'APPOINTMENT', capacity: 1, specialty: 'Pediatria',
      professionalId: 'pro_rui', startsAt: new Date(2026, 10, 9, 9, 30).toISOString(), durationMinutes: 30,
    })
    const { generation, rule } = await catalog.createClinicScheduleRule(ADMIN, newRule({ weekdays: [1] }), NOW)
    // 09:00–09:45 e 09:45–10:30 sobrepõem-se a 09:30–10:00; o das 10:30 não.
    expect(generation.skippedOverlap).toBe(2)
    expect(ruleSlots(rule.id).some((s) => s.startsAt === new Date(2026, 10, 9, 9, 0).toISOString())).toBe(false)
    expect(db.slots.some((s) => s.id === 'slot_manual')).toBe(true)
  })

  it('desativar a regra remove livres futuros e mantém os marcados', async () => {
    const booked = ruleSlots('rul_cardio_tarde')[0]!
    db.appointments.push({
      id: 'apt_x', familyId: 'f', memberId: 'm', status: 'SCHEDULED', scheduledAt: booked.startsAt, slotId: booked.id, clinicId: 'cln_horizonte',
    } as never)
    const total = ruleSlots('rul_cardio_tarde').length
    const { generation, rule } = await catalog.updateClinicScheduleRule(MANAGER, 'rul_cardio_tarde', { active: false }, NOW)
    expect(rule.active).toBe(false)
    expect(generation).toMatchObject({ removed: total - 1, keptBooked: 1 })
    expect(ruleSlots('rul_cardio_tarde')).toEqual([booked])
    expect(db.appointments.find((a) => a.id === 'apt_x')!.status).toBe('SCHEDULED')
    // Reativar não repõe sozinho, mas a geração seguinte sim.
    const again = await catalog.updateClinicScheduleRule(MANAGER, 'rul_cardio_tarde', { active: true }, NOW)
    expect(again.generation.created).toBe(total - 1)
  })

  it('desativar profissional ou serviço reconcilia as regras', async () => {
    await catalog.updateClinicProfessional(ADMIN, 'pro_ana', { active: false }, NOW)
    expect(ruleSlots('rul_cardio_tarde')).toHaveLength(0)
    expect(await code(catalog.createClinicScheduleRule(ADMIN, newRule({ professionalId: 'pro_ana' }), NOW))).toBe('CONFLICT')
  })
})

describe('slots gerados e publicação manual', () => {
  it('um horário gerado não se remove (CONFLICT)', async () => {
    const slot = ruleSlots('rul_cardio_tarde')[0]!
    expect(await code(portal.removeClinicSlot(ADMIN, slot.id))).toBe('CONFLICT')
    expect(db.slots.some((s) => s.id === slot.id)).toBe(true)
  })

  it('publicação manual com serviço usa duração e nome do serviço', async () => {
    const created = await portal.publishClinicSlots(
      MANAGER,
      { kind: 'APPOINTMENT', date: '2026-11-20', times: ['08:00', '08:45'], professionalId: 'pro_rui', serviceTypeId: 'svc_pedia' },
      NOW,
    )
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ specialty: 'Consulta de pediatria', durationMinutes: 45, professionalName: 'Dr. Rui Mendes', serviceTypeId: 'svc_pedia' })
    expect(await code(portal.removeClinicSlot(MANAGER, created[0]!.id))).toBe('OK')
    expect(await code(portal.publishClinicSlots(MANAGER, { kind: 'EXAM', date: '2026-11-20', times: ['09:00'], serviceTypeId: 'svc_pedia' }, NOW))).toBe('VALIDATION_ERROR')
  })

  it('sobreposição do profissional → CONFLICT e nada é criado; duplicado exato é ignorado', async () => {
    const base = { kind: 'APPOINTMENT' as const, date: '2026-11-20', professionalId: 'pro_rui', serviceTypeId: 'svc_pedia' }
    await portal.publishClinicSlots(MANAGER, { ...base, times: ['08:00'] }, NOW)
    const count = db.slots.length
    expect(await code(portal.publishClinicSlots(MANAGER, { ...base, times: ['09:00', '08:30'] }, NOW))).toBe('CONFLICT')
    expect(db.slots).toHaveLength(count)
    expect(await portal.publishClinicSlots(MANAGER, { ...base, times: ['08:00'] }, NOW)).toEqual([])
    // Contíguo (fim = início) é válido.
    expect(await portal.publishClinicSlots(MANAGER, { ...base, times: ['08:45'] }, NOW)).toHaveLength(1)
  })

  it('profissional de outra clínica → NOT_FOUND', async () => {
    expect(await code(portal.publishClinicSlots(OTHER, { kind: 'APPOINTMENT', date: '2026-11-20', times: ['09:00'], professionalId: 'pro_ana', specialty: 'X', durationMinutes: 30 }, NOW))).toBe('NOT_FOUND')
  })

  it('horários manuais sem profissional continuam como antes', async () => {
    const created = await portal.publishClinicSlots(MANAGER, { kind: 'APPOINTMENT', date: '2026-11-20', times: ['09:00'], specialty: 'Geral', durationMinutes: 30 }, NOW)
    expect(created[0]).toMatchObject({ specialty: 'Geral', professionalId: undefined })
  })
})

describe('bloqueios / férias', () => {
  const range = (days: number, hours = 0) => ({
    startsAt: new Date(2026, 10, 9, 0, 0).toISOString(),
    endsAt: new Date(2026, 10, 9 + days, hours, 0).toISOString(),
  })

  it('remove os livres, devolve os marcados e a geração ignora o intervalo', async () => {
    const monday = ruleSlots('rul_cardio_tarde').filter((s) => new Date(s.startsAt).getDate() === 9 && new Date(s.startsAt).getMonth() === 10)
    expect(monday.length).toBeGreaterThan(0)
    const booked = monday[0]!
    db.appointments.push({ id: 'apt_y', familyId: 'f', memberId: 'm', status: 'REQUESTED', scheduledAt: booked.startsAt, slotId: booked.id, clinicId: 'cln_horizonte' } as never)

    const result = await catalog.createClinicTimeOff(MANAGER, { professionalId: 'pro_ana', ...range(1), reason: ' férias ' }, NOW)
    expect(result.timeOff).toMatchObject({ reason: 'férias', bookedSlotCount: 1 })
    expect(result.removedSlots).toBe(monday.length - 1)
    expect(result.bookedSlots).toEqual([{ slotId: booked.id, kind: 'APPOINTMENT', startsAt: booked.startsAt, durationMinutes: 30, bookedCount: 1 }])
    expect(db.appointments.find((a) => a.id === 'apt_y')!.status).toBe('REQUESTED')

    const regen = await catalog.regenerateClinicScheduleRule(ADMIN, 'rul_cardio_tarde', NOW)
    expect(regen.generation.created).toBe(0)
    expect(regen.generation.skippedTimeOff).toBe(monday.length - 1)

    // Publicação manual dentro do bloqueio → CONFLICT.
    expect(await code(portal.publishClinicSlots(ADMIN, { kind: 'APPOINTMENT', date: '2026-11-09', times: ['10:00'], professionalId: 'pro_ana', serviceTypeId: 'svc_cardio' }, NOW))).toBe('CONFLICT')

    expect(await catalog.listClinicTimeOff(ADMIN, { professionalId: 'pro_ana' }, NOW)).toHaveLength(1)
    // Remover regenera.
    const restored = await catalog.deleteClinicTimeOff(ADMIN, result.timeOff.id, NOW)
    expect(restored.created).toBe(monday.length - 1)
    expect(await catalog.listClinicTimeOff(ADMIN, {}, NOW)).toHaveLength(0)
  })

  it('validações e isolamento', async () => {
    expect(await code(catalog.createClinicTimeOff(ADMIN, { professionalId: 'pro_ana', startsAt: range(1).endsAt, endsAt: range(1).startsAt }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(catalog.createClinicTimeOff(ADMIN, { professionalId: 'pro_ana', startsAt: new Date(2025, 0, 1).toISOString(), endsAt: new Date(2025, 0, 2).toISOString() }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(catalog.createClinicTimeOff(ADMIN, { professionalId: 'pro_ana', ...range(400) }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(catalog.createClinicTimeOff(OTHER, { professionalId: 'pro_ana', ...range(1) }, NOW))).toBe('NOT_FOUND')
    const ok = await catalog.createClinicTimeOff(ADMIN, { professionalId: 'pro_ana', ...range(1) }, NOW)
    expect(await code(catalog.deleteClinicTimeOff(OTHER, ok.timeOff.id, NOW))).toBe('NOT_FOUND')
    expect(await catalog.listClinicTimeOff(OTHER, {}, NOW)).toEqual([])
  })
})
