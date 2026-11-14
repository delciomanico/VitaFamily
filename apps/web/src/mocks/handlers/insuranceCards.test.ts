import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as cards from './insuranceCards'
import * as ops from './insurerOps'

const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const ANA = 'usr_ana'
const SELF = 'mem_monarca'
const MARIA = 'mem_maria' // dependente de Monarca
const MANAGER = 'iac_aurora_manager'
const request = { insurerId: 'ins_aurora', policyNumber: 'AP-2026-0001', code: 'JOAO-2345' }

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

async function linked(memberId = SELF) {
  const claim = await cards.claimCard(FAMILY, MONARCA, memberId, request)
  await ops.confirmLinkRequest(MANAGER, claim.id)
  return claim
}

beforeEach(() => resetDb())

describe('reclamar cartão (BR-SEG-20)', () => {
  it('cria um pedido PENDING, consome o código e a seguradora nunca vê a família', async () => {
    const claim = await cards.claimCard(FAMILY, MONARCA, SELF, request)
    expect(claim).toMatchObject({ status: 'PENDING', insurerName: 'Seguradora Aurora', beneficiaryId: null })
    expect(await failure(cards.claimCard(FAMILY, MONARCA, MARIA, request))).toBe('NOT_FOUND') // uso único
    const seen = await ops.listLinkRequests(MANAGER, { status: 'PENDING' })
    expect(JSON.stringify(seen)).not.toMatch(/familyId|memberId|mem_|fam_/)
  })

  it('apólice errada, código errado, expirado, usado ou de outro paciente: sempre o mesmo NOT_FOUND', async () => {
    expect(await failure(cards.claimCard(FAMILY, MONARCA, SELF, { ...request, policyNumber: 'AP-0' }))).toBe('NOT_FOUND')
    expect(await failure(cards.claimCard(FAMILY, MONARCA, SELF, { ...request, code: 'XXXXXXXX' }))).toBe('NOT_FOUND')
    db.insurerOps.claimCodes[0]!.expiresAt = '2020-01-01T00:00:00.000Z'
    expect(await failure(cards.claimCard(FAMILY, MONARCA, SELF, request))).toBe('NOT_FOUND')
    db.insurerOps.claimCodes[0]!.expiresAt = '2030-01-01T00:00:00.000Z'
    await cards.claimCard(FAMILY, MONARCA, SELF, request)
    db.insurerOps.claimCodes[0]!.used = false // reposto: o beneficiário já está ligado a este membro, não a outro
    expect(await failure(cards.claimCard(FAMILY, MONARCA, MARIA, request))).toBe('NOT_FOUND')
  })

  it('o código aceita minúsculas, com ou sem hífen (como o backend)', async () => {
    const claim = await cards.claimCard(FAMILY, MONARCA, SELF, { ...request, code: ' joao 2345 ' })
    expect(claim.status).toBe('PENDING')
  })

  it('um beneficiário por membro e seguradora ⇒ CONFLICT; seguradora sem módulo ⇒ NOT_FOUND', async () => {
    await cards.claimCard(FAMILY, MONARCA, SELF, request)
    db.insurerOps.claimCodes.push({ insurerId: 'ins_aurora', beneficiaryId: 'ben_ana', code: 'ANA32345', expiresAt: '2030-01-01T00:00:00.000Z', used: false })
    expect(await failure(cards.claimCard(FAMILY, MONARCA, SELF, { ...request, code: 'ANA32345' }))).toBe('NOT_FOUND') // outra apólice
    db.insurerOps.modules.ins_aurora!.enabled = false
    expect(await failure(cards.claimCard(FAMILY, MONARCA, MARIA, request))).toBe('NOT_FOUND')
    expect(await cards.listCardClaims(FAMILY, MONARCA, SELF)).toEqual([])
  })

  it('o CONFLICT só aparece com pedido em curso do mesmo membro', async () => {
    await cards.claimCard(FAMILY, MONARCA, SELF, request)
    db.insurerOps.claimCodes[0]!.used = false
    expect(await failure(cards.claimCard(FAMILY, MONARCA, SELF, request))).toBe('CONFLICT')
  })

  it('rate limit: 10 tentativas por 15 min, com Retry-After', async () => {
    for (let i = 0; i < 10; i++) await failure(cards.claimCard(FAMILY, MONARCA, SELF, { ...request, code: 'ERRADO00' }))
    const error = (await cards.claimCard(FAMILY, MONARCA, SELF, request).catch((e: AppError) => e)) as AppError
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('matriz do paciente', () => {
  it('só o próprio e o tutor; outro membro recebe NOT_FOUND (nunca FORBIDDEN)', async () => {
    expect(await failure(cards.listCards(FAMILY, MONARCA, SELF))).toBe('OK')
    expect(await failure(cards.listCards(FAMILY, MONARCA, MARIA))).toBe('OK') // TUTOR_OF
    expect(await failure(cards.listCards(FAMILY, ANA, SELF))).toBe('NOT_FOUND')
    expect(await failure(cards.listCardClaims(FAMILY, ANA, MARIA))).toBe('NOT_FOUND')
    expect(await failure(cards.claimCard(FAMILY, ANA, SELF, request))).toBe('NOT_FOUND')
  })

  it('perfil bloqueado ⇒ MEMBER_BLOCKED', async () => {
    db.members.find((m) => m.id === MARIA)!.status = 'BLOCKED'
    expect(await failure(cards.listCards(FAMILY, MONARCA, MARIA))).toBe('MEMBER_BLOCKED')
    expect(await failure(cards.claimCard(FAMILY, MONARCA, MARIA, request))).toBe('MEMBER_BLOCKED')
  })
})

describe('cartão, QR e cobertura', () => {
  it('só há cartão depois de a seguradora confirmar; mostra plano e validade da apólice ativa', async () => {
    const claim = await cards.claimCard(FAMILY, MONARCA, SELF, request)
    expect(await cards.listCards(FAMILY, MONARCA, SELF)).toEqual([])
    await ops.confirmLinkRequest(MANAGER, claim.id)
    const [card] = await cards.listCards(FAMILY, MONARCA, SELF)
    expect(card).toMatchObject({ cardNumber: 'AUR-000001', currency: 'AOA', status: 'ACTIVE', planName: 'Plano Básico', validTo: '2027-12-31' })
    expect((await cards.listCardClaims(FAMILY, MONARCA, SELF))[0]).toMatchObject({ status: 'CONFIRMED', beneficiaryId: 'ben_joao' })
  })

  it('QR com validade de 120 s e limite de 20 por 10 min', async () => {
    await linked()
    const now = new Date('2026-11-12T10:00:00.000Z')
    const qr = await cards.getCardQr(FAMILY, MONARCA, SELF, 'ben_joao', now)
    expect(new Date(qr.expiresAt).getTime() - now.getTime()).toBe(120_000)
    expect(qr.token).toBe('qr.ins_aurora.AUR-000001')
    for (let i = 1; i < 20; i++) await cards.getCardQr(FAMILY, MONARCA, SELF, 'ben_joao', now)
    expect(await cards.getCardQr(FAMILY, MONARCA, SELF, 'ben_joao', now).catch((e: AppError) => e.code)).toBe('RATE_LIMITED')
    expect(await failure(cards.getCardQr(FAMILY, MONARCA, SELF, 'ben_ana'))).toBe('NOT_FOUND')
  })

  it('cobertura: só limites anuais (sem usado/saldo), carência e moeda; não ACTIVE sem coberturas', async () => {
    await linked()
    const coverage = await cards.getCardCoverage(FAMILY, MONARCA, SELF, 'ben_joao', new Date('2026-01-10T10:00:00'))
    expect(coverage.currency).toBe('AOA')
    expect(coverage.coverages.map((c) => c.serviceCode)).toEqual(['CONS-GER', 'LAB-HEM', 'IMG-RX'])
    expect(coverage.coverages[1]).toMatchObject({ limitPerYear: 50000, coveredNow: true })
    expect(coverage.coverages[2]).toMatchObject({ coveredNow: false, waitingEndsOn: '2026-01-31' })
    expect(JSON.stringify(coverage)).not.toMatch(/used|reserved|available|balance/i)

    db.insurerOps.beneficiaries.find((b) => b.id === 'ben_joao')!.status = 'SUSPENDED'
    expect(await cards.getCardCoverage(FAMILY, MONARCA, SELF, 'ben_joao')).toMatchObject({ status: 'SUSPENDED', coverages: [] })
  })

  it('desligar: só CONFIRMED; o cartão desaparece e o QR deixa de ser emitido', async () => {
    const claim = await linked()
    await cards.revokeCardClaim(FAMILY, MONARCA, SELF, claim.id)
    expect(await cards.listCards(FAMILY, MONARCA, SELF)).toEqual([])
    expect(await failure(cards.getCardQr(FAMILY, MONARCA, SELF, 'ben_joao'))).toBe('NOT_FOUND')
    expect(await failure(cards.revokeCardClaim(FAMILY, MONARCA, SELF, claim.id))).toBe('CONFLICT')
    expect((await cards.listCardClaims(FAMILY, MONARCA, SELF))[0]!.status).toBe('REVOKED')
  })

  it('rejeição pela seguradora mostra o motivo ao paciente', async () => {
    const claim = await cards.claimCard(FAMILY, MONARCA, SELF, request)
    await ops.rejectLinkRequest(MANAGER, claim.id, 'Dados não coincidem')
    expect((await cards.listCardClaims(FAMILY, MONARCA, SELF))[0]).toMatchObject({ status: 'REJECTED', decisionNote: 'Dados não coincidem' })
  })
})
