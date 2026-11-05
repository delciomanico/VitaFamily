import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as ins from './insurance'
import * as portal from './insurancePortal'

const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const MARIA = 'mem_maria'
const ADMIN = 'iac_aurora_admin'
const AGENT = 'iac_aurora_agent'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

/** Pedido SUBMITTED da Maria na Aurora. */
async function submit() {
  db.documents.push({
    id: 'doc_f',
    familyId: FAMILY,
    memberId: MARIA,
    resourceType: 'PRESCRIPTION',
    resourceId: 'x',
    originalName: 'f.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    createdAt: new Date().toISOString(),
  })
  const policy = await ins.createInsurancePolicy(FAMILY, MONARCA, MARIA, {
    insurerId: 'ins_aurora',
    insurerName: 'Aurora',
    policyNumber: 'P-9',
    holderName: 'Maria',
    validUntil: null,
  })
  return ins.submitReimbursementClaim(FAMILY, MONARCA, MARIA, policy.id, { amount: 30, documentIds: ['doc_f'] })
}

beforeEach(() => resetDb())

describe('portal da seguradora', () => {
  it('login: credenciais erradas ou conta suspensa', async () => {
    expect(await code(portal.insuranceLogin('admin@seguradoraaurora.pt', 'x'))).toBe('INVALID_CREDENTIALS')
    db.insuranceAccounts[0]!.status = 'SUSPENDED'
    expect(await code(portal.insuranceLogin('admin@seguradoraaurora.pt', db.insuranceAccounts[0]!.password))).toBe(
      'ACCOUNT_SUSPENDED',
    )
  })

  it('a seguradora vê só o mínimo e nunca família nem membro', async () => {
    const claim = await submit()
    const [view] = await portal.listInsuranceClaims(AGENT)
    expect(view).toMatchObject({ id: claim.id, policyHolderName: 'Maria', policyNumber: 'P-9', status: 'SUBMITTED' })
    expect(Object.keys(view!).sort()).toEqual(
      ['amount', 'currency', 'decisionNote', 'documentIds', 'id', 'policyHolderName', 'policyNumber', 'status'],
    )
  })

  it('isola seguradoras: outra seguradora não vê nem decide', async () => {
    const claim = await submit()
    db.insurers.push({ id: 'ins_b', name: 'B', taxId: '500000001', status: 'ACTIVE' })
    db.insuranceAccounts.push({
      id: 'iac_b',
      insurerId: 'ins_b',
      email: 'b@b.pt',
      password: 'x',
      role: 'INSURANCE_ADMIN',
      status: 'ACTIVE',
    })
    expect(await portal.listInsuranceClaims('iac_b')).toEqual([])
    expect(await code(portal.decideInsuranceClaim('iac_b', claim.id, 'APPROVE'))).toBe('NOT_FOUND')
  })

  it('decide: recusar exige motivo; decidido não volta a decidir; titular marca pago', async () => {
    const claim = await submit()
    expect(await code(portal.decideInsuranceClaim(AGENT, claim.id, 'REJECT'))).toBe('VALIDATION_ERROR')
    expect((await portal.decideInsuranceClaim(AGENT, claim.id, 'APPROVE', ' ok ')).decisionNote).toBe('ok')
    expect(await code(portal.decideInsuranceClaim(ADMIN, claim.id, 'REJECT', 'x'))).toBe('CONFLICT')
    const policyId = db.insurancePolicies[0]!.id
    expect((await ins.markReimbursementClaimPaid(FAMILY, MONARCA, MARIA, policyId, claim.id)).status).toBe('PAID')
  })

  it('só o Admin gere agentes, e e-mail repetido é recusado', async () => {
    expect(await code(portal.listInsuranceAgents(AGENT))).toBe('FORBIDDEN')
    const created = await portal.createInsuranceAgent(ADMIN, ' Novo@Aurora.pt ')
    expect(created).toMatchObject({ email: 'novo@aurora.pt', role: 'INSURANCE_AGENT' })
    expect(await code(portal.createInsuranceAgent(ADMIN, 'novo@aurora.pt'))).toBe('VALIDATION_ERROR')
    expect(await code(portal.removeInsuranceAgent(ADMIN, created.id))).toBe('OK')
    expect(await code(portal.removeInsuranceAgent(ADMIN, ADMIN))).toBe('NOT_FOUND')
  })
})
