import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as ins from './insurance'

const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const ANA = 'usr_ana'
const MARIA = 'mem_maria' // dependente de Monarca
const policyInput = (insurerId: string | null = 'ins_aurora') => ({
  insurerId,
  insurerName: 'Seguradora Aurora',
  policyNumber: 'P-1',
  holderName: 'Maria',
  validUntil: null,
})

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

function doc(memberId = MARIA) {
  db.documents.push({
    id: 'doc_fatura',
    familyId: FAMILY,
    memberId,
    resourceType: 'PRESCRIPTION',
    resourceId: 'x',
    originalName: 'fatura.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    createdAt: new Date().toISOString(),
  })
  return 'doc_fatura'
}

beforeEach(() => resetDb())

describe('seguro do titular', () => {
  it('só o próprio ou o tutor acedem; outro membro é recusado', async () => {
    expect(await code(ins.listInsurancePolicies(FAMILY, MONARCA, MARIA))).toBe('OK')
    expect(await code(ins.listInsurancePolicies(FAMILY, ANA, MARIA))).toBe('FORBIDDEN')
    expect(await code(ins.createInsurancePolicy(FAMILY, ANA, MARIA, policyInput()))).toBe('FORBIDDEN')
  })

  it('cria apólice, valida campos e seguradora inativa', async () => {
    const policy = await ins.createInsurancePolicy(FAMILY, MONARCA, MARIA, policyInput())
    expect(policy).toMatchObject({ insurerId: 'ins_aurora', cardDocumentId: null })
    expect(await code(ins.createInsurancePolicy(FAMILY, MONARCA, MARIA, { ...policyInput(), policyNumber: ' ' }))).toBe(
      'VALIDATION_ERROR',
    )
    db.insurers[0]!.status = 'SUSPENDED'
    expect(await code(ins.createInsurancePolicy(FAMILY, MONARCA, MARIA, policyInput()))).toBe('VALIDATION_ERROR')
    expect(await ins.listPartnerInsurers()).toEqual([])
  })

  it('pedido de reembolso: precisa de parceira, documentos do membro e montante válido', async () => {
    const free = await ins.createInsurancePolicy(FAMILY, MONARCA, MARIA, policyInput(null))
    const partner = await ins.createInsurancePolicy(FAMILY, MONARCA, MARIA, policyInput())
    const id = doc()
    expect(await code(ins.submitReimbursementClaim(FAMILY, MONARCA, MARIA, free.id, { amount: 10, documentIds: [id] }))).toBe(
      'VALIDATION_ERROR',
    )
    expect(await code(ins.submitReimbursementClaim(FAMILY, MONARCA, MARIA, partner.id, { amount: 10.555, documentIds: [id] }))).toBe(
      'VALIDATION_ERROR',
    )
    expect(await code(ins.submitReimbursementClaim(FAMILY, MONARCA, MARIA, partner.id, { amount: 10, documentIds: ['nope'] }))).toBe(
      'VALIDATION_ERROR',
    )
    const claim = await ins.submitReimbursementClaim(FAMILY, MONARCA, MARIA, partner.id, { amount: 25.5, documentIds: [id] })
    expect(claim).toMatchObject({ status: 'SUBMITTED', currency: 'EUR', amount: 25.5 })
    expect(claim).not.toHaveProperty('insurerId')

    db.insurers[0]!.status = 'SUSPENDED'
    expect(await code(ins.submitReimbursementClaim(FAMILY, MONARCA, MARIA, partner.id, { amount: 5, documentIds: [id] }))).toBe(
      'CONFLICT',
    )
  })

  it('pago só depois de aprovado; apólice com pedido em curso não se apaga', async () => {
    const policy = await ins.createInsurancePolicy(FAMILY, MONARCA, MARIA, policyInput())
    const claim = await ins.submitReimbursementClaim(FAMILY, MONARCA, MARIA, policy.id, { amount: 5, documentIds: [doc()] })
    expect(await code(ins.markReimbursementClaimPaid(FAMILY, MONARCA, MARIA, policy.id, claim.id))).toBe('CONFLICT')
    expect(await code(ins.deleteInsurancePolicy(FAMILY, MONARCA, MARIA, policy.id))).toBe('CONFLICT')
    db.reimbursementClaims[0]!.status = 'APPROVED'
    expect((await ins.markReimbursementClaimPaid(FAMILY, MONARCA, MARIA, policy.id, claim.id)).status).toBe('PAID')
    expect(await code(ins.deleteInsurancePolicy(FAMILY, MONARCA, MARIA, policy.id))).toBe('OK')
  })
})
