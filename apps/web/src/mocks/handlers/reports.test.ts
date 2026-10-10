import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { DEMO_INVITATION_CODE } from '../data/families'
import { DEMO_VERIFICATION_CODE } from '../data/users'
import { resetDb } from '../db'
import { day } from '../time'
import * as auth from './auth'
import * as family from './family'
import * as reports from './reports'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 4, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

beforeEach(() => resetDb(NOW))

describe('visão familiar (UC-RPT-02)', () => {
  it('inclui o próprio, os dependentes e quem partilha, cada um só nas categorias visíveis', async () => {
    const report = await reports.getFamilyReport(FAMILY, MONARCA, NOW)
    expect(report.familySize).toBe(5)
    expect(report.members.map((r) => r.member.id)).toEqual([
      'mem_monarca',
      'mem_maria',
      'mem_joao',
      'mem_pedro',
      'mem_ana',
    ])

    const ana = report.members.find((r) => r.member.id === 'mem_ana')!
    expect(ana).toMatchObject({ manage: false, allergies: ['Ácaros'] })
    expect(ana.upcomingAppointments?.map((a) => a.appointment.id)).toEqual(['apt_ana'])
    expect(ana.conditions).toBeUndefined()
    expect(ana.activeMedications).toBeUndefined()
    expect(ana.upcomingExaminations).toBeUndefined()
    // Sem dados de saúde fora das categorias (C1 apenas).
    expect(ana.member).not.toHaveProperty('bloodType')
  })

  it('lista os pendentes de quem gere', async () => {
    const report = await reports.getFamilyReport(FAMILY, MONARCA, NOW)
    const joao = report.members.find((r) => r.member.id === 'mem_joao')!
    expect(joao.pending.map((p) => [p.type, p.label]).sort()).toEqual([
      ['APPOINTMENT_OUTCOME', 'Endocrinologia'],
      ['UNCONFIRMED_DOSE', 'Metformina 850 mg'],
    ])
    expect(report.members.find((r) => r.member.id === 'mem_pedro')?.upcomingExaminations).toHaveLength(1)
  })

  it('o Admin não vê mais por ser Admin; um novo membro só vê o que lhe partilham (D13)', async () => {
    await auth.register({
      name: 'Rui Teste',
      email: 'rui@exemplo.test',
      birthDate: '1990-01-01',
      password: 'uma-frase-longa',
      timezone: 'Africa/Luanda',
      termsVersion: '2026-01',
    })
    const user = await auth.verifyEmail('rui@exemplo.test', DEMO_VERIFICATION_CODE)
    await family.joinFamily(user.id, DEMO_INVITATION_CODE)

    const report = await reports.getFamilyReport(FAMILY, user.id, NOW)
    expect(report.members.map((r) => r.member.name)).toEqual(['Rui Teste', 'Ana Lopes'])
    const ana = report.members[1]!
    // Ana partilha as Consultas com todos, mas as Alergias só com Monarca.
    expect(ana.categories).toEqual(['APPOINTMENTS'])
    expect(ana.allergies).toBeUndefined()
  })
})

describe('relatório individual (UC-RPT-01)', () => {
  it('usa os últimos 12 meses por defeito', async () => {
    const report = await reports.getMemberReport(FAMILY, MONARCA, 'mem_monarca', {}, NOW)
    expect(report).toMatchObject({ from: '2025-10-04', to: '2026-10-04' })
    expect(report.examinations?.map((e) => e.examination.id)).not.toContain('exm_2024')

    const fiveYears = await reports.getMemberReport(FAMILY, MONARCA, 'mem_monarca', { from: '2021-10-04' }, NOW)
    expect(fiveYears.examinations?.map((e) => e.examination.id)).toContain('exm_2024')
  })

  it('recusa períodos inválidos ou com mais de 5 anos (BR-RPT-02)', async () => {
    const report = (period: { from?: string; to?: string }) =>
      code(reports.getMemberReport(FAMILY, MONARCA, 'mem_monarca', period, NOW))
    expect(await report({ from: '2021-10-03', to: '2026-10-04' })).toBe('VALIDATION_ERROR')
    expect(await report({ from: '2026-10-05', to: '2026-10-04' })).toBe('VALIDATION_ERROR')
    expect(await report({ from: 'ontem' })).toBe('VALIDATION_ERROR')
  })

  it('omite as secções sem permissão (BR-RPT-01)', async () => {
    const ana = await reports.getMemberReport(FAMILY, MONARCA, 'mem_ana', {}, NOW)
    expect(ana.categories).toEqual(['ALLERGIES', 'APPOINTMENTS'])
    expect(ana.allergies).toEqual(['Ácaros'])
    for (const hidden of ['conditions', 'prescriptions', 'medications', 'adherence', 'examinations'] as const) {
      expect(ana[hidden]).toBeUndefined()
    }
  })

  it('conta as tomas por estado, sem interpretação (UC-RPT-03)', async () => {
    const joao = await reports.getMemberReport(FAMILY, MONARCA, 'mem_joao', {}, NOW)
    expect(joao.adherence?.find((a) => a.planId === 'med_metformina')).toMatchObject({
      taken: 0,
      notTaken: 0,
      unconfirmed: 1,
      pending: 1,
    })
    expect(joao.pending.map((p) => p.type).sort()).toEqual(['APPOINTMENT_OUTCOME', 'UNCONFIRMED_DOSE'])
  })

  it('inclui as próximas consultas e exames, além dos do período', async () => {
    const maria = await reports.getMemberReport(FAMILY, MONARCA, 'mem_maria', { from: day(-30, NOW) }, NOW)
    expect(maria.appointments?.map((a) => a.appointment.id)).toEqual(['apt_derma'])
    expect(maria.examinations?.map((e) => e.examination.id)).toEqual(['exm_maria'])
  })

  it('membro que não partilha nada ou de outra família → NOT_FOUND', async () => {
    expect(await code(reports.getMemberReport(FAMILY, 'usr_ana', 'mem_joao', {}, NOW))).toBe('NOT_FOUND')
    expect(await code(reports.getMemberReport(FAMILY, MONARCA, 'mem_x', {}, NOW))).toBe('NOT_FOUND')
    expect(await code(reports.getMemberReport('fam_x', MONARCA, 'mem_monarca', {}, NOW))).toBe('NOT_FOUND')
  })
})
