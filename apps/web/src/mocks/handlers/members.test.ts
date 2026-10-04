import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { resetDb } from '../db'
import * as family from './family'
import * as members from './members'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 4, 12, 0)
const FAMILY = 'fam_monarca'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

beforeEach(() => resetDb(NOW))

describe('minha família', () => {
  it('lista o próprio primeiro, com acompanhamento dos que gere e partilha dos outros', async () => {
    const overview = await members.getFamilyOverview(FAMILY, 'usr_monarca', NOW)
    expect(overview.family.name).toBe('Família Monarca')
    expect(overview.isAdmin).toBe(true)
    expect(overview.members[0]).toMatchObject({ isSelf: true, manage: true })
    const byName = Object.fromEntries(overview.members.map((m) => [m.member.name, m.tracking]))
    expect(byName['João Lopes']).toEqual({ kind: 'PENDING', count: 2 })
    expect(byName['Pedro Lopes']).toEqual({ kind: 'UP_TO_DATE' })
    expect(byName['Ana Lopes']).toEqual({ kind: 'SHARED', categories: ['APPOINTMENTS', 'ALLERGIES'] })
  })

  it('nunca envia dados de saúde na lista (só C1)', async () => {
    const overview = await members.getFamilyOverview(FAMILY, 'usr_monarca', NOW)
    for (const card of overview.members) {
      expect(card.member).not.toHaveProperty('bloodType')
      expect(card.member).not.toHaveProperty('userId')
    }
  })
})

describe('perfil do membro', () => {
  it('quem gere vê todas as secções', async () => {
    const profile = await members.getMemberProfile(FAMILY, 'usr_monarca', 'mem_joao', NOW)
    expect(profile.manage).toBe(true)
    expect(profile.conditions).toEqual(['Diabetes tipo 2', 'Hipertensão arterial'])
    expect(profile.medications?.map((m) => m.plan.name)).toEqual(['Metformina', 'Losartana'])
    expect(profile.guardians).toEqual(['Monarca Lopes'])
  })

  it('de um adulto, só as categorias partilhadas (Ana: consultas e alergias)', async () => {
    const profile = await members.getMemberProfile(FAMILY, 'usr_monarca', 'mem_ana', NOW)
    expect(profile.manage).toBe(false)
    expect(profile.allergies).toEqual(['Ácaros'])
    expect(profile.appointments?.map((a) => a.appointment.specialty)).toEqual(['Oftalmologia'])
    expect(profile.conditions).toBeUndefined()
    expect(profile.medications).toBeUndefined()
    expect(profile.examinations).toBeUndefined()
    expect(profile.canRemove).toBe(false)
  })

  it('partilha só com Monarca não chega a outros membros', async () => {
    // A Ana vê o Monarca só por C1 (ele não partilha nada).
    const profile = await members.getMemberProfile(FAMILY, 'usr_ana', 'mem_monarca', NOW)
    expect(profile.access).toEqual([])
    expect(profile.bloodType).toBeUndefined()
  })

  it('histórico só com as categorias visíveis', async () => {
    const history = await members.getMemberHistory(FAMILY, 'usr_monarca', 'mem_ana', NOW)
    expect(history.hidden).toEqual(['EXAMS', 'MEDICATION', 'CONDITIONS'])
    expect(history.entries.every((e) => e.kind === 'APPOINTMENT')).toBe(true)
  })

  it('membro de outra família → NOT_FOUND', async () => {
    expect(await code(members.getMemberProfile(FAMILY, 'usr_monarca', 'mem_x', NOW))).toBe('NOT_FOUND')
  })

  it('só se removem dependentes sem conta', async () => {
    expect(await code(family.removeMember(FAMILY, 'usr_monarca', 'mem_ana'))).toBe('CONFLICT')
    expect(await code(family.removeMember(FAMILY, 'usr_monarca', 'mem_pedro'))).toBe('OK')
  })
})
