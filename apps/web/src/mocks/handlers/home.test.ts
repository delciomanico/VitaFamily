import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_INVITATION_CODE } from '../data/families'
import { DEMO_VERIFICATION_CODE } from '../data/users'
import { resetDb } from '../db'
import * as auth from './auth'
import * as family from './family'
import { getHomeSummary } from './home'
import { pendingItems } from './reports'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 4, 12, 0)

beforeEach(() => resetDb(NOW))

describe('resumo da Home (Monarca, tutor de Maria, João e Pedro)', () => {
  it('mostra a próxima consulta agendada', async () => {
    const { nextAppointment } = await getHomeSummary('fam_monarca', 'usr_monarca', NOW)
    expect(nextAppointment?.appointment.id).toBe('apt_cardio')
    expect(nextAppointment?.isSelf).toBe(true)
  })

  it('conta tomas pendentes de hoje, resultados novos e membros', async () => {
    const { today } = await getHomeSummary('fam_monarca', 'usr_monarca', NOW)
    // Amoxicilina 16:00 e 22:00 + Metformina 20:00 (a das 08:00 ficou não confirmada).
    expect(today).toEqual({ pendingDoses: 3, newResults: 2, members: 5 })
  })

  it('lista as tomas de hoje por hora, com estado', async () => {
    const { todayDoses } = await getHomeSummary('fam_monarca', 'usr_monarca', NOW)
    expect(todayDoses.map((d) => [d.medication, d.status])).toEqual([
      ['Amoxicilina 500 mg', 'TAKEN'],
      ['Metformina 850 mg', 'UNCONFIRMED'],
      ['Losartana 50 mg', 'TAKEN'],
      ['Amoxicilina 500 mg', 'PENDING'],
      ['Metformina 850 mg', 'PENDING'],
      ['Amoxicilina 500 mg', 'PENDING'],
    ])
    expect(todayDoses[1]).toMatchObject({ memberName: 'João Lopes', isSelf: false })
  })

  it('só João tem acompanhamento pendente (toma não confirmada e consulta passada)', async () => {
    const { family: overview } = await getHomeSummary('fam_monarca', 'usr_monarca', NOW)
    expect(overview).toEqual({ tracked: 4, withPending: 1 })
    const kinds = pendingItems('fam_monarca', ['mem_joao'], NOW)
      .map((p) => p.kind)
      .sort()
    expect(kinds).toEqual(['APPOINTMENT_OVERDUE', 'DOSE_UNCONFIRMED'])
  })

  it('lista os alertas recentes, lidos e por ler, mais recentes primeiro', async () => {
    const { recentAlerts } = await getHomeSummary('fam_monarca', 'usr_monarca', NOW)
    // Ao meio-dia: lembrete de consulta (10:00), toma das 08:00, pedido de resultado (ontem), exame (lido).
    expect(recentAlerts.map((a) => a.id)).toEqual(['alr_cardio', 'alr_amox', 'alr_endocrino', 'alr_maria'])
    expect(recentAlerts[3]?.readAt).toBeDefined()
    expect(recentAlerts[1]).toMatchObject({
      memberName: 'Monarca Lopes',
      sourceLabel: 'Amoxicilina 500 mg',
      sourceId: 'dose_med_amox_0800',
    })
    expect(recentAlerts[1]).not.toHaveProperty('recipientUserId')
  })
})

describe('permissões', () => {
  it('um membro sem tutela só vê os próprios dados', async () => {
    await auth.register({
      name: 'Ana Teste',
      email: 'ana@exemplo.test',
      birthDate: '1990-01-01',
      password: 'uma-frase-longa',
      timezone: 'Africa/Luanda',
      termsVersion: '2026-01',
    })
    const user = await auth.verifyEmail('ana@exemplo.test', DEMO_VERIFICATION_CODE)
    await family.joinFamily(user.id, DEMO_INVITATION_CODE)

    const summary = await getHomeSummary('fam_monarca', user.id, NOW)
    expect(summary.nextAppointment).toBeNull()
    expect(summary.family).toEqual({ tracked: 1, withPending: 0 })
    expect(summary.recentAlerts).toEqual([])
  })

  it('quem não pertence à família não obtém o resumo', async () => {
    await expect(getHomeSummary('fam_monarca', 'usr_desconhecido', NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
