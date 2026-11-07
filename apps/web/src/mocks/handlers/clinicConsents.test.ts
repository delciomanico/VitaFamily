import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as consents from './clinicConsents'

const NOW = new Date(2026, 10, 5, 8, 0)
const FAMILY = 'fam_monarca'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

beforeEach(() => resetDb(NOW))

describe('consentimento por clínica (BR-CLN-19)', () => {
  it('lista quem vê o quê: HISTORY com validade e BOOKINGS ligado', async () => {
    const monarca = await consents.listClinicConsents(FAMILY, 'usr_monarca', 'mem_monarca', NOW)
    expect(monarca).toEqual([
      expect.objectContaining({ clinicId: 'cln_horizonte', clinicName: 'Clínica Horizonte', level: 'HISTORY', linked: true, renewalNeeded: false }),
    ])
    expect(monarca[0]!.validUntil).not.toBeNull()
    const pedro = await consents.listClinicConsents(FAMILY, 'usr_monarca', 'mem_pedro', NOW)
    expect(pedro[0]).toMatchObject({ level: 'BOOKINGS', validUntil: null })
  })

  it('HISTORY expirado aparece como BOOKINGS com renewalNeeded; renovar repõe 12 meses', async () => {
    const later = new Date(2027, 11, 20)
    expect((await consents.listClinicConsents(FAMILY, 'usr_monarca', 'mem_monarca', later))[0]).toMatchObject({
      level: 'BOOKINGS',
      renewalNeeded: true,
      validUntil: null,
    })
    const renewed = await consents.putClinicConsent(FAMILY, 'usr_monarca', 'mem_monarca', 'cln_horizonte', 'HISTORY', later)
    expect(renewed).toMatchObject({ level: 'HISTORY', renewalNeeded: false })
    expect(new Date(renewed.validUntil!).getFullYear()).toBe(2028)
  })

  it('concede (mesmo antes da ligação), altera e é idempotente; BOOKINGS retira o histórico', async () => {
    const granted = await consents.putClinicConsent(FAMILY, 'usr_monarca', 'mem_maria', 'cln_vidaplena', 'HISTORY', NOW)
    expect(granted).toMatchObject({ clinicName: 'Laboratório Vida Plena', level: 'HISTORY', linked: false })
    await consents.putClinicConsent(FAMILY, 'usr_monarca', 'mem_maria', 'cln_vidaplena', 'HISTORY', NOW)
    expect(db.clinicConsents.filter((c) => c.memberId === 'mem_maria')).toHaveLength(1)
    expect(await consents.putClinicConsent(FAMILY, 'usr_monarca', 'mem_maria', 'cln_vidaplena', 'BOOKINGS', NOW)).toMatchObject({
      level: 'BOOKINGS',
      validUntil: null,
    })
  })

  it('só clínicas parceiras ativas; nível inválido é 422', async () => {
    expect(await code(consents.putClinicConsent(FAMILY, 'usr_monarca', 'mem_maria', 'cln_bairro', 'HISTORY', NOW))).toBe('NOT_FOUND')
    expect(await code(consents.putClinicConsent(FAMILY, 'usr_monarca', 'mem_maria', 'cln_inexistente', 'HISTORY', NOW))).toBe('NOT_FOUND')
    expect(await code(consents.putClinicConsent(FAMILY, 'usr_monarca', 'mem_maria', 'cln_vidaplena', 'ALL' as never, NOW))).toBe('VALIDATION_ERROR')
    db.clinics.find((c) => c.id === 'cln_vidaplena')!.status = 'ARCHIVED'
    expect(await code(consents.putClinicConsent(FAMILY, 'usr_monarca', 'mem_maria', 'cln_vidaplena', 'HISTORY', NOW))).toBe('NOT_FOUND')
  })

  it('revoga consentimento e ligação; sem nenhum dos dois é NOT_FOUND', async () => {
    expect(await code(consents.revokeClinicConsent(FAMILY, 'usr_monarca', 'mem_monarca', 'cln_horizonte'))).toBe('OK')
    expect(await consents.listClinicConsents(FAMILY, 'usr_monarca', 'mem_monarca', NOW)).toEqual([])
    expect(db.clinicPatients.find((p) => p.id === 'cpt_monarca')?.memberId).toBeUndefined()
    expect(await code(consents.revokeClinicConsent(FAMILY, 'usr_monarca', 'mem_monarca', 'cln_horizonte'))).toBe('NOT_FOUND')
  })

  it('só o titular adulto ou o tutor: outro membro e dependente com conta são FORBIDDEN', async () => {
    // Ana é adulta de outra pessoa (OTHER) → nunca, mesmo com partilha.
    expect(await code(consents.listClinicConsents(FAMILY, 'usr_ana', 'mem_monarca', NOW))).toBe('FORBIDDEN')
    expect(await code(consents.listClinicConsents(FAMILY, 'usr_ana', 'mem_ana', NOW))).toBe('OK')
    // Dependente com conta própria não consente (N2).
    const ana = db.members.find((m) => m.id === 'mem_ana')!
    ana.isDependent = true
    expect(await code(consents.listClinicConsents(FAMILY, 'usr_ana', 'mem_ana', NOW))).toBe('FORBIDDEN')
    expect(await code(consents.putClinicConsent(FAMILY, 'usr_ana', 'mem_ana', 'cln_horizonte', 'HISTORY', NOW))).toBe('FORBIDDEN')
    expect(await code(consents.createClinicLinkCode(FAMILY, 'usr_ana', 'mem_ana', NOW))).toBe('FORBIDDEN')
    // O tutor consente pelo dependente sem conta.
    expect(await code(consents.putClinicConsent(FAMILY, 'usr_monarca', 'mem_joao', 'cln_horizonte', 'BOOKINGS', NOW))).toBe('OK')
  })
})

describe('código de ligação (BR-CLN-20)', () => {
  it('8 caracteres do alfabeto, válido 10 minutos; gerar outro invalida o anterior; 5/hora por membro', async () => {
    const first = await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_monarca', NOW)
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(Date.parse(first.expiresAt) - NOW.getTime()).toBe(10 * 60_000)
    await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_monarca', NOW)
    expect(db.clinicLinkCodes.find((c) => c.code === first.code)?.used).toBe(true)
    for (let i = 0; i < 3; i++) await consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_monarca', NOW)
    expect(await code(consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_monarca', NOW))).toBe('RATE_LIMITED')
    // Passada a hora, volta a ser possível; outro membro não é afetado.
    expect(await code(consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_monarca', new Date(NOW.getTime() + 61 * 60_000)))).toBe('OK')
    expect(await code(consents.createClinicLinkCode(FAMILY, 'usr_monarca', 'mem_pedro', NOW))).toBe('OK')
  })
})
