import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as apt from './appointments'
import * as portal from './clinicPortal'
import * as exams from './examinations'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 4, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const ADMIN = 'cac_horizonte_admin'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

const book = (slotId: string, memberId: string) =>
  exams.createExamination(
    FAMILY,
    MONARCA,
    { memberId, name: 'x', examDate: '2026-10-05', slotId, results: [], documents: [] },
    NOW,
  )

/** Horário de exame criado só para o teste, com as vagas indicadas. */
async function publish(capacity: number) {
  const [slot] = await portal.publishClinicSlots(
    ADMIN,
    { kind: 'EXAM', capacity, date: '2026-10-06', times: ['11:00'], specialty: 'Raio-X', durationMinutes: 30 },
    NOW,
  )
  return slot!
}

beforeEach(() => resetDb(NOW))

describe('exames com vagas (ADR-023, BR-APT-11)', () => {
  it('o exame nasce agendado e ocupa uma vaga até esgotar', async () => {
    const slot = await publish(2)
    expect((await book(slot.id, 'mem_monarca')).status).toBe('SCHEDULED')
    await book(slot.id, 'mem_maria')
    expect(await code(book(slot.id, 'mem_pedro'))).toBe('CONFLICT')
    const [view] = await portal.listOwnClinicSlots(ADMIN, 'EXAM', NOW).then((l) => l.filter((s) => s.id === slot.id))
    expect(view).toMatchObject({ bookedCount: 2, remaining: 0, state: 'FULL' })
  })

  it('o mesmo membro não ocupa duas vagas do mesmo horário', async () => {
    const slot = await publish(3)
    await book(slot.id, 'mem_monarca')
    expect(await code(book(slot.id, 'mem_monarca'))).toBe('CONFLICT')
  })

  it('só horários com vagas são oferecidos à família; cancelar liberta a vaga', async () => {
    const slot = await publish(1)
    const exam = await book(slot.id, 'mem_monarca')
    const offered = async () => (await apt.listAvailableSlots(FAMILY, '', NOW, 'EXAM')).some((s) => s.id === slot.id)
    expect(await offered()).toBe(false)
    await portal.cancelClinicExam(ADMIN, exam.id, 'Equipamento avariado')
    expect(await offered()).toBe(true)
  })

  it('as consultas nunca veem horários de exame', async () => {
    const slots = await apt.listAvailableSlots(FAMILY, 'Análises clínicas', NOW)
    expect(slots).toHaveLength(0)
  })

  it('alterar vagas nunca fica abaixo das marcações ativas', async () => {
    const slot = await publish(3)
    await book(slot.id, 'mem_monarca')
    await book(slot.id, 'mem_maria')
    expect(await code(portal.updateClinicSlotCapacity(ADMIN, slot.id, 1))).toBe('CONFLICT')
    expect((await portal.updateClinicSlotCapacity(ADMIN, slot.id, 5)).remaining).toBe(3)
  })

  it('capacidade > 1 só em exames', async () => {
    const result = portal.publishClinicSlots(
      ADMIN,
      { kind: 'APPOINTMENT', capacity: 2, date: '2026-10-06', times: ['11:00'], specialty: 'Cardiologia', durationMinutes: 30 },
      NOW,
    )
    expect(await code(result)).toBe('VALIDATION_ERROR')
  })

  it('não remove um horário com marcação ativa', async () => {
    const slot = await publish(2)
    await book(slot.id, 'mem_monarca')
    expect(await code(portal.removeClinicSlot(ADMIN, slot.id))).toBe('CONFLICT')
  })

  it('a clínica emite resultados e o paciente passa a vê-los; o exame fica realizado', async () => {
    const slot = await publish(1)
    const exam = await book(slot.id, 'mem_monarca')
    expect(await code(portal.completeClinicExam(ADMIN, exam.id, { results: [] }, NOW))).toBe('VALIDATION_ERROR')
    const done = await portal.completeClinicExam(
      ADMIN,
      exam.id,
      { results: [{ parameter: 'Glicemia', valueNumeric: 92, unit: 'mg/dL' }] },
      NOW,
    )
    expect(done).toMatchObject({ status: 'COMPLETED', resultsCount: 1 })
    expect(db.examResults.some((r) => r.examinationId === exam.id && r.parameter === 'Glicemia')).toBe(true)
    expect(await code(portal.completeClinicExam(ADMIN, exam.id, { results: [] }, NOW))).toBe('CONFLICT')
  })

  it('uma clínica não vê exames de outra (NOT_FOUND)', async () => {
    const [slot] = db.slots.filter((s) => s.kind === 'EXAM' && s.clinicId === 'cln_vidaplena')
    const exam = await book(slot!.id, 'mem_monarca')
    expect(await code(portal.cancelClinicExam(ADMIN, exam.id, 'x'))).toBe('NOT_FOUND')
  })
})
