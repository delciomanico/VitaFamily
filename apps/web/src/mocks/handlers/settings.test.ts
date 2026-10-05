import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/settings'
import { db, resetDb } from '../db'
import { at } from '../time'
import * as account from './account'
import * as alerts from './alerts'
import * as members from './members'
import * as sharing from './sharing'

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

beforeEach(() => resetDb(NOW))

describe('a minha conta (UC-ACC-04)', () => {
  it('altera nome e fuso; o nome do membro acompanha', async () => {
    const user = await account.updateMe(MONARCA, { name: ' Monarca L. ', timezone: 'Europe/Lisbon' })
    expect(user).toMatchObject({ name: 'Monarca L.', timezone: 'Europe/Lisbon' })
    expect(user).not.toHaveProperty('password')
    expect(db.members.find((m) => m.id === 'mem_monarca')?.name).toBe('Monarca L.')
    expect(await code(account.updateMe(MONARCA, { name: 'Monarca', timezone: 'Lua/Base' }))).toBe('VALIDATION_ERROR')
  })

  it('muda a palavra-passe só com a atual correta e uma nova forte', async () => {
    const change = (currentPassword: string, newPassword: string) =>
      code(account.changePassword(MONARCA, { currentPassword, newPassword }))
    expect(await change('errada', 'uma-frase-bem-longa')).toBe('INVALID_CREDENTIALS')
    expect(await change('password', 'curta')).toBe('PASSWORD_WEAK')
    expect(await change('password', 'uma-frase-bem-longa')).toBe('OK')
    expect(db.users.find((u) => u.id === MONARCA)?.password).toBe('uma-frase-bem-longa')
  })
})

describe('preferências de alertas (UC-ALR-05)', () => {
  it('começa com tudo ativo e guarda por utilizador', async () => {
    expect(await account.getNotificationPreferences(MONARCA)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
    await account.putNotificationPreferences(MONARCA, { ...DEFAULT_NOTIFICATION_PREFERENCES, emailEnabled: false })
    expect((await account.getNotificationPreferences(MONARCA)).emailEnabled).toBe(false)
    expect((await account.getNotificationPreferences(ANA)).emailEnabled).toBe(true)
  })

  it('desativar um tipo deixa de criar esses alertas para si, sem os recuperar ao reativar', async () => {
    const off = { ...DEFAULT_NOTIFICATION_PREFERENCES, medicationDue: false }
    await account.putNotificationPreferences(MONARCA, off)
    const evening = new Date(at(0, '20:30', NOW))
    const doseAlerts = async (now: Date) =>
      (await alerts.listAlerts(FAMILY, MONARCA, now)).filter((a) => a.sourceId === 'dose_med_metformina_2000')
    expect(await doseAlerts(evening)).toEqual([])

    await account.putNotificationPreferences(MONARCA, DEFAULT_NOTIFICATION_PREFERENCES)
    expect(await doseAlerts(evening)).toEqual([])
    // Os outros tipos continuam a chegar.
    expect((await alerts.listAlerts(FAMILY, MONARCA, evening)).some((a) => a.type === 'APPOINTMENT_REMINDER')).toBe(
      true,
    )
  })
})

describe('partilha por categoria (UC-PRV-01/02)', () => {
  it('o titular define quem lê cada categoria, com efeito imediato', async () => {
    const before = await members.getMemberProfile(FAMILY, MONARCA, 'mem_ana', NOW)
    expect(before.examinations).toBeUndefined()

    await sharing.putSharing(FAMILY, ANA, 'mem_ana', [
      { category: 'EXAMS', granteeMemberId: 'mem_monarca' },
      // Toda a família dispensa a concessão individual na mesma categoria.
      { category: 'APPOINTMENTS' },
      { category: 'APPOINTMENTS', granteeMemberId: 'mem_monarca' },
    ])
    const settings = await sharing.getSharing(FAMILY, ANA, 'mem_ana')
    expect(settings.grants).toEqual([
      { category: 'EXAMS', granteeMemberId: 'mem_monarca' },
      { category: 'APPOINTMENTS' },
    ])
    expect((await members.getMemberProfile(FAMILY, MONARCA, 'mem_ana', NOW)).examinations).toBeDefined()
    // Retirou as alergias: Monarca deixa de as ver.
    expect((await members.getMemberProfile(FAMILY, MONARCA, 'mem_ana', NOW)).allergies).toBeUndefined()
  })

  it('pelos dependentes decide o tutor; ninguém define a partilha de outro adulto', async () => {
    expect(await code(sharing.putSharing(FAMILY, MONARCA, 'mem_pedro', [{ category: 'EXAMS' }]))).toBe('OK')
    expect(await code(sharing.getSharing(FAMILY, MONARCA, 'mem_ana'))).toBe('FORBIDDEN')
    expect(await code(sharing.putSharing(FAMILY, ANA, 'mem_pedro', []))).toBe('FORBIDDEN')
  })

  it('só se partilha com quem tem conta e ainda não vê tudo', async () => {
    const pedro = await sharing.getSharing(FAMILY, MONARCA, 'mem_pedro')
    // Monarca é o tutor (já vê tudo); Maria e João não têm conta.
    expect(pedro.others.map((m) => m.id)).toEqual(['mem_ana'])
    expect(
      await code(
        sharing.putSharing(FAMILY, MONARCA, 'mem_pedro', [{ category: 'EXAMS', granteeMemberId: 'mem_maria' }]),
      ),
    ).toBe('VALIDATION_ERROR')
  })

  it('recusa destinatários inválidos', async () => {
    const put = (granteeMemberId: string) =>
      code(sharing.putSharing(FAMILY, ANA, 'mem_ana', [{ category: 'EXAMS', granteeMemberId }]))
    expect(await put('mem_ana')).toBe('VALIDATION_ERROR')
    expect(await put('mem_x')).toBe('VALIDATION_ERROR')
  })

  it('mostra o que os outros partilham comigo', async () => {
    expect(await sharing.sharedWithMe(FAMILY, MONARCA)).toEqual([
      { memberId: 'mem_ana', memberName: 'Ana Lopes', categories: ['ALLERGIES', 'APPOINTMENTS'] },
    ])
    expect(await sharing.sharedWithMe(FAMILY, ANA)).toEqual([])
  })
})

describe('privacidade (UC-ACC-05/06)', () => {
  it('exporta só os dados de que é titular, no máximo 3 vezes por dia', async () => {
    const item = await account.requestMyExport(ANA, NOW)
    expect(item.status).toBe('READY')
    const data = await account.downloadMyExport(ANA, item.id, NOW)
    expect(data.account.email).toBe('ana@vitafamily.app')
    expect(data.families[0]?.allergies.map((a) => a.name)).toEqual(['Ácaros'])
    expect(data.families[0]?.appointments.every((a) => a.memberId === 'mem_ana')).toBe(true)

    expect(await code(account.downloadMyExport(MONARCA, item.id, NOW))).toBe('NOT_FOUND')
    await account.requestMyExport(ANA, NOW)
    await account.requestMyExport(ANA, NOW)
    expect(await code(account.requestMyExport(ANA, NOW))).toBe('RATE_LIMITED')

    const later = new Date(NOW.getTime() + 8 * 86_400_000)
    expect((await account.listMyExports(ANA, later))[0]?.status).toBe('EXPIRED')
    expect(await code(account.downloadMyExport(ANA, item.id, later))).toBe('NOT_FOUND')
  })

  it('não elimina a conta do único tutor ou único Admin (BR-ACC-06)', async () => {
    expect(await code(account.deleteMe(MONARCA, 'errada'))).toBe('INVALID_CREDENTIALS')
    expect(await code(account.deleteMe(MONARCA, 'password'))).toBe('ACCOUNT_DELETION_BLOCKED')
  })

  it('elimina a conta e tudo o que é seu (BR-ACC-07)', async () => {
    expect(await code(account.deleteMe(ANA, 'password'))).toBe('OK')
    expect(db.users.some((u) => u.id === ANA)).toBe(false)
    expect(db.members.some((m) => m.id === 'mem_ana')).toBe(false)
    expect(db.appointments.some((a) => a.memberId === 'mem_ana')).toBe(false)
    expect(db.allergies.some((a) => a.memberId === 'mem_ana')).toBe(false)
    expect(db.sharingGrants.some((g) => g.ownerMemberId === 'mem_ana')).toBe(false)
    // A família continua, com os outros membros.
    expect(db.families.some((f) => f.id === FAMILY)).toBe(true)
  })
})
