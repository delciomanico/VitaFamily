import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as clinic from './clinicInsurers'

const ADMIN = 'cac_horizonte_admin'
const MANAGER = 'cac_horizonte_rececao'
const DOCTOR = 'cac_horizonte_medica'
const INSURER = 'ins_aurora'
const NOW = new Date('2026-11-12T10:00:00')

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

beforeEach(() => resetDb())

describe('validação de beneficiário na clínica', () => {
  it('Admin e Gestor veem a seguradora; o Médico é FORBIDDEN', async () => {
    expect(await clinic.listClinicInsurers(MANAGER)).toEqual([{ id: INSURER, name: 'Seguradora Aurora', currency: 'AOA' }])
    expect(await code(clinic.listClinicInsurers(DOCTOR))).toBe('FORBIDDEN')
    expect(await code(clinic.checkEligibility(DOCTOR, INSURER, { cardNumber: 'AUR-000001' }))).toBe('FORBIDDEN')
  })

  it('clínica não ligada, ligação suspensa ou módulo desativado ⇒ NOT_FOUND (sem enumeração)', async () => {
    expect(await code(clinic.checkEligibility(ADMIN, 'ins_outra', { cardNumber: 'x' }))).toBe('NOT_FOUND')
    db.insurerOps.providers[0]!.status = 'SUSPENDED'
    expect(await clinic.listClinicInsurers(ADMIN)).toEqual([])
    expect(await code(clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'AUR-000001' }))).toBe('NOT_FOUND')
    db.insurerOps.providers[0]!.status = 'ACTIVE'
    db.insurerOps.modules[INSURER]!.enabled = false
    expect(await code(clinic.listClinicInsurerServices(ADMIN, INSURER))).toBe('NOT_FOUND')
  })

  it('exige exatamente um identificador', async () => {
    expect(await code(clinic.checkEligibility(ADMIN, INSURER, {}))).toBe('VALIDATION_ERROR')
    expect(await code(clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'a', qrToken: 'b' }))).toBe('VALIDATION_ERROR')
  })

  it('elegível: resposta mínima com carência e moeda; por cartão, QR e documento', async () => {
    const byCard = await clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'aur-000001' }, NOW)
    expect(byCard).toMatchObject({ eligible: true, beneficiaryName: 'João Mendes', planName: 'Plano Básico', currency: 'AOA', status: 'ACTIVE' })
    expect(byCard.notice).toMatch(/não garantia de pagamento/)
    const rx = byCard.coverages!.find((c) => c.serviceCode === 'IMG-RX')!
    // Apólice desde 2026-01-01 + 30 dias de carência: já cumpridos em novembro.
    expect(rx).toMatchObject({ coveredNow: true, waitingDays: 30, requiresAuthorization: true })
    expect(Object.keys(byCard).sort()).toEqual(['beneficiaryName', 'coverages', 'currency', 'eligible', 'notice', 'planName', 'status', 'validFrom', 'validTo'])

    expect((await clinic.checkEligibility(ADMIN, INSURER, { qrToken: `qr.${INSURER}.AUR-000001` }, NOW)).eligible).toBe(true)
    // Dependente herda a apólice do titular.
    expect((await clinic.checkEligibility(ADMIN, INSURER, { idDocument: { type: 'BI', number: '000333444LA051' } }, NOW)).beneficiaryName).toBe('Ana Mendes')
    const one = await clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'AUR-000001', serviceCode: 'LAB-HEM' }, NOW)
    expect(one.coverages!.map((c) => c.serviceCode)).toEqual(['LAB-HEM'])
  })

  it('carência ainda por cumprir', async () => {
    const early = await clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'AUR-000001', serviceCode: 'IMG-RX' }, new Date('2026-01-10T10:00:00'))
    expect(early.coverages![0]).toMatchObject({ coveredNow: false, waitingEndsOn: '2026-01-31' })
  })

  it('inexistente, pendente, sem apólice ou QR de outra seguradora devolvem a MESMA resposta', async () => {
    const same = { eligible: false, notice: clinic.ELIGIBILITY_NOTICE }
    expect(await clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'NAO-EXISTE' }, NOW)).toEqual(same)
    expect(await clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'AUR-000003' }, NOW)).toEqual(same) // PENDING
    expect(await clinic.checkEligibility(ADMIN, INSURER, { qrToken: 'qr.ins_x.AUR-000001' }, NOW)).toEqual(same)
    expect(await clinic.checkEligibility(ADMIN, INSURER, { qrToken: 'lixo' }, NOW)).toEqual(same)
    db.insurerOps.policies[0]!.status = 'SUSPENDED'
    expect(await clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'AUR-000001' }, NOW)).toEqual(same)
  })

  it('rate limit: 429 com Retry-After', async () => {
    for (let i = 0; i < clinic.ELIGIBILITY_LIMIT; i++) await clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'x' }, NOW)
    const error = await clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'x' }, NOW).catch((e: AppError) => e)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: clinic.RETRY_AFTER_SECONDS })
    // Passada a janela, volta a funcionar.
    const later = new Date(NOW.getTime() + clinic.ELIGIBILITY_WINDOW_MS + 1)
    expect((await clinic.checkEligibility(ADMIN, INSURER, { cardNumber: 'x' }, later)).eligible).toBe(false)
  })

  it('lista de serviços: só ativos e só código, nome e categoria; pesquisa e paginação', async () => {
    const page = await clinic.listClinicInsurerServices(MANAGER, INSURER)
    expect(page.items.map((s) => s.code)).toEqual(['CONS-GER', 'IMG-RX', 'LAB-HEM'])
    expect(Object.keys(page.items[0]!).sort()).toEqual(['category', 'code', 'name'])
    expect((await clinic.listClinicInsurerServices(MANAGER, INSURER, { q: 'hemo' })).items.length).toBe(1)
    expect((await clinic.listClinicInsurerServices(MANAGER, INSURER, { limit: 2 })).nextCursor).toBe('2')
  })
})
