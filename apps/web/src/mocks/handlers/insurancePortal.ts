import { AppError } from '@/lib/errors'
import type { ClaimDecision, ClaimStatus, InsuranceAccount, InsuranceClaimView, InsuranceSession } from '@/types/insurance'
import { DEMO_PASSWORD } from '../data/users'
import type { MockInsuranceAccountRecord } from '../data/insurers'
import { insuranceReceiptSummaries } from '../clinicReceipts'
import { db, newId } from '../db'
import { respond } from '../respond'

const NOTE_MAX = 1000

function toSession(account: MockInsuranceAccountRecord): InsuranceSession {
  return { insurerId: account.insurerId, role: account.role, email: account.email }
}

const toPublicAccount = ({ id, insurerId, email, role, status }: MockInsuranceAccountRecord): InsuranceAccount => ({
  id,
  insurerId,
  email,
  role,
  status,
})

function requireAccount(accountId: string): MockInsuranceAccountRecord {
  const account = db.insuranceAccounts.find((a) => a.id === accountId && a.status === 'ACTIVE')
  if (!account) throw new AppError('INVALID_CREDENTIALS')
  return account
}

function requireAdmin(accountId: string): MockInsuranceAccountRecord {
  const account = requireAccount(accountId)
  if (account.role !== 'INSURANCE_ADMIN') throw new AppError('FORBIDDEN')
  return account
}

// --- Sessão (`/insurance-portal/auth/*`) ---

export interface MockInsuranceLoginResult extends InsuranceSession {
  insuranceAccountId: string
}

export function insuranceLogin(email: string, password: string) {
  return respond((): MockInsuranceLoginResult => {
    const account = db.insuranceAccounts.find((a) => a.email === email.trim().toLowerCase())
    if (!account || account.password !== password) throw new AppError('INVALID_CREDENTIALS')
    if (account.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED')
    return { insuranceAccountId: account.id, ...toSession(account) }
  })
}

export function insuranceRefresh(insuranceAccountId: string) {
  return respond((): MockInsuranceLoginResult | null => {
    const account = db.insuranceAccounts.find((a) => a.id === insuranceAccountId && a.status === 'ACTIVE')
    return account ? { insuranceAccountId: account.id, ...toSession(account) } : null
  })
}

// --- Agentes (`/insurance-portal/agents`, BR-INS-06) ---

export function listInsuranceAgents(accountId: string) {
  return respond(() => {
    const admin = requireAdmin(accountId)
    return db.insuranceAccounts
      .filter((a) => a.insurerId === admin.insurerId && a.role === 'INSURANCE_AGENT')
      .map(toPublicAccount)
      .sort((a, b) => a.email.localeCompare(b.email, 'pt-PT'))
  })
}

/** Cria sempre um `INSURANCE_AGENT`; e-mail em uso → 422. */
export function createInsuranceAgent(accountId: string, email: string) {
  return respond((): InsuranceAccount => {
    const admin = requireAdmin(accountId)
    const address = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AppError('VALIDATION_ERROR')
    if (db.insuranceAccounts.some((a) => a.email === address)) throw new AppError('VALIDATION_ERROR')
    const account: MockInsuranceAccountRecord = {
      id: newId('iac'),
      insurerId: admin.insurerId,
      email: address,
      password: DEMO_PASSWORD,
      role: 'INSURANCE_AGENT',
      status: 'ACTIVE',
    }
    db.insuranceAccounts.push(account)
    return toPublicAccount(account)
  })
}

export function removeInsuranceAgent(accountId: string, targetId: string) {
  return respond(() => {
    const admin = requireAdmin(accountId)
    const target = db.insuranceAccounts.find(
      (a) => a.id === targetId && a.insurerId === admin.insurerId && a.role === 'INSURANCE_AGENT',
    )
    if (!target) throw new AppError('NOT_FOUND')
    db.insuranceAccounts = db.insuranceAccounts.filter((a) => a.id !== targetId)
    return undefined
  })
}

// --- Pedidos (`/insurance-portal/claims`, BR-INS-04/05/07) ---

function toView(claim: (typeof db.reimbursementClaims)[number]): InsuranceClaimView {
  const policy = db.insurancePolicies.find((p) => p.id === claim.policyId)
  return {
    id: claim.id,
    status: claim.status,
    amount: claim.amount,
    currency: claim.currency,
    policyHolderName: policy?.holderName ?? '',
    policyNumber: policy?.policyNumber ?? '',
    decisionNote: claim.decisionNote,
    documentIds: claim.documentIds,
    receipts: insuranceReceiptSummaries(claim.receiptIds),
  }
}

/** Pedido desta seguradora; de outra → NOT_FOUND (sem enumeração). */
function findClaim(insurerId: string, claimId: string) {
  const claim = db.reimbursementClaims.find((c) => c.id === claimId && c.insurerId === insurerId)
  if (!claim) throw new AppError('NOT_FOUND')
  return claim
}

export function listInsuranceClaims(accountId: string, status?: ClaimStatus) {
  return respond(() => {
    const { insurerId } = requireAccount(accountId)
    return db.reimbursementClaims
      .filter((c) => c.insurerId === insurerId && (!status || c.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toView)
  })
}

export function getInsuranceClaim(accountId: string, claimId: string) {
  return respond(() => toView(findClaim(requireAccount(accountId).insurerId, claimId)))
}

/** `PUT …/decide`: só `SUBMITTED`; recusar exige motivo (BR-INS-05). */
export function decideInsuranceClaim(accountId: string, claimId: string, decision: ClaimDecision, note?: string) {
  return respond(() => {
    const claim = findClaim(requireAccount(accountId).insurerId, claimId)
    const text = note?.trim() || null
    if (decision === 'REJECT' && !text) throw new AppError('VALIDATION_ERROR')
    if (text && text.length > NOTE_MAX) throw new AppError('VALIDATION_ERROR')
    if (claim.status !== 'SUBMITTED') throw new AppError('CONFLICT')
    claim.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    claim.decisionNote = text
    return toView(claim)
  })
}
