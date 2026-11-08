import { AppError } from '@/lib/errors'
import type {
  ClaimInput,
  InsurancePolicy,
  InsurancePolicyInput,
  PartnerInsurer,
  ReimbursementClaim,
} from '@/types/insurance'
import { INSURANCE_TEXT_MAX } from '@/types/insurance'
import { memberAccess } from '../access'
import { activeClaimsOfReceipt, claimReceiptRefs } from '../clinicReceipts'
import { db, newId } from '../db'
import { respond } from '../respond'

/** BR-INS-02: só o próprio (adulto) ou o tutor do dependente; `OTHER` nunca, mesmo com partilha. */
function requireHolder(familyId: string, userId: string, memberId: string) {
  if (!memberAccess(familyId, userId, memberId).manage) throw new AppError('FORBIDDEN')
}

function findPolicy(familyId: string, memberId: string, policyId: string) {
  const policy = db.insurancePolicies.find((p) => p.id === policyId && p.familyId === familyId && p.memberId === memberId)
  if (!policy) throw new AppError('NOT_FOUND')
  return policy
}

const publicPolicy = ({ familyId: _familyId, ...policy }: InsurancePolicy & { familyId: string }): InsurancePolicy => {
  const card = db.documents.find((d) => d.resourceType === 'INSURANCE_POLICY' && d.resourceId === policy.id)
  return { ...policy, cardDocumentId: card?.id ?? null }
}

const publicClaim = ({
  familyId: _f,
  memberId: _m,
  insurerId: _i,
  receiptIds,
  ...claim
}: ReimbursementClaim & {
  familyId: string
  memberId: string
  insurerId: string
  receiptIds?: string[]
}): ReimbursementClaim => ({ ...claim, receipts: claimReceiptRefs(receiptIds) })

function validatePolicy(input: InsurancePolicyInput) {
  const texts = [input.insurerName, input.policyNumber, input.holderName]
  if (texts.some((t) => !t.trim() || t.trim().length > INSURANCE_TEXT_MAX)) throw new AppError('VALIDATION_ERROR')
  if (input.insurerId && !db.insurers.some((i) => i.id === input.insurerId && i.status === 'ACTIVE')) {
    throw new AppError('VALIDATION_ERROR')
  }
}

/** `GET /families/{f}/insurers`: só seguradoras `ACTIVE` (BR-INS-09). */
export function listPartnerInsurers(): Promise<PartnerInsurer[]> {
  return respond(() =>
    db.insurers
      .filter((i) => i.status === 'ACTIVE')
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT')),
  )
}

export function listInsurancePolicies(familyId: string, userId: string, memberId: string) {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    return db.insurancePolicies
      .filter((p) => p.familyId === familyId && p.memberId === memberId)
      .map(publicPolicy)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
}

export function createInsurancePolicy(familyId: string, userId: string, memberId: string, input: InsurancePolicyInput) {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    validatePolicy(input)
    const policy = {
      id: newId('pol'),
      familyId,
      memberId,
      insurerId: input.insurerId,
      insurerName: input.insurerName.trim(),
      policyNumber: input.policyNumber.trim(),
      holderName: input.holderName.trim(),
      validUntil: input.validUntil,
      cardDocumentId: null,
      createdAt: new Date().toISOString(),
    }
    db.insurancePolicies.push(policy)
    return publicPolicy(policy)
  })
}

export function updateInsurancePolicy(
  familyId: string,
  userId: string,
  memberId: string,
  policyId: string,
  input: InsurancePolicyInput,
) {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    const policy = findPolicy(familyId, memberId, policyId)
    validatePolicy(input)
    Object.assign(policy, {
      insurerId: input.insurerId,
      insurerName: input.insurerName.trim(),
      policyNumber: input.policyNumber.trim(),
      holderName: input.holderName.trim(),
      validUntil: input.validUntil,
    })
    return publicPolicy(policy)
  })
}

/** `DELETE`: 409 se houver pedido `SUBMITTED` ou `APPROVED`. */
export function deleteInsurancePolicy(familyId: string, userId: string, memberId: string, policyId: string) {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    const policy = findPolicy(familyId, memberId, policyId)
    if (db.reimbursementClaims.some((c) => c.policyId === policyId && (c.status === 'SUBMITTED' || c.status === 'APPROVED'))) {
      throw new AppError('CONFLICT')
    }
    db.insurancePolicies = db.insurancePolicies.filter((p) => p !== policy)
    db.reimbursementClaims = db.reimbursementClaims.filter((c) => c.policyId !== policyId)
    db.documents = db.documents.filter((d) => !(d.resourceType === 'INSURANCE_POLICY' && d.resourceId === policyId))
    return undefined
  })
}

export function listReimbursementClaims(familyId: string, userId: string, memberId: string, policyId: string) {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    findPolicy(familyId, memberId, policyId)
    return db.reimbursementClaims
      .filter((c) => c.policyId === policyId)
      .map(publicClaim)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
}

/** BR-INS-03/04: apólice com seguradora parceira ativa; só documentos do próprio membro. */
export function submitReimbursementClaim(
  familyId: string,
  userId: string,
  memberId: string,
  policyId: string,
  input: ClaimInput,
): Promise<ReimbursementClaim> {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    const policy = findPolicy(familyId, memberId, policyId)
    if (!policy.insurerId) throw new AppError('VALIDATION_ERROR')
    const insurer = db.insurers.find((i) => i.id === policy.insurerId)
    if (!insurer) throw new AppError('VALIDATION_ERROR')
    if (insurer.status !== 'ACTIVE') throw new AppError('CONFLICT')
    const cents = Math.round(input.amount * 100)
    if (!(input.amount > 0) || Math.abs(cents - input.amount * 100) > 1e-6) throw new AppError('VALIDATION_ERROR')
    const ids = [...new Set(input.documentIds)]
    const receiptIds = [...new Set(input.receiptIds ?? [])]
    const own = db.documents.filter((d) => d.familyId === familyId && d.memberId === memberId)
    // M14 R (BR-CLN-36): documentos + recibos entre 1 e 10 no total.
    if (
      ids.length + receiptIds.length < 1 ||
      ids.length + receiptIds.length > 10 ||
      receiptIds.length > 10 ||
      ids.some((id) => !own.some((d) => d.id === id && d.scanStatus !== 'INFECTED'))
    ) {
      throw new AppError('VALIDATION_ERROR')
    }
    const currency = input.currency ?? 'EUR'
    for (const receiptId of receiptIds) {
      // Só os recibos visíveis ao membro (BR-CLN-35); outro → NOT_FOUND.
      const receipt = db.clinicReceipts.find(
        (r) => r.id === receiptId && r.link?.familyId === familyId && r.link.memberId === memberId,
      )
      if (!receipt) throw new AppError('NOT_FOUND')
      if (receipt.status !== 'ISSUED' || activeClaimsOfReceipt(receipt.id).length > 0) throw new AppError('CONFLICT')
      if (receipt.currency !== currency) throw new AppError('VALIDATION_ERROR')
    }
    const claim = {
      id: newId('clm'),
      familyId,
      memberId,
      insurerId: insurer.id,
      policyId,
      amount: input.amount,
      currency,
      status: 'SUBMITTED' as const,
      decisionNote: null,
      documentIds: ids,
      receiptIds,
      createdAt: new Date().toISOString(),
    }
    db.reimbursementClaims.push(claim)
    return publicClaim(claim)
  })
}

/** `PUT …/paid`: só o titular, e só depois de `APPROVED` (BR-INS-05). */
export function markReimbursementClaimPaid(
  familyId: string,
  userId: string,
  memberId: string,
  policyId: string,
  claimId: string,
): Promise<ReimbursementClaim> {
  return respond(() => {
    requireHolder(familyId, userId, memberId)
    findPolicy(familyId, memberId, policyId)
    const claim = db.reimbursementClaims.find((c) => c.id === claimId && c.policyId === policyId)
    if (!claim) throw new AppError('NOT_FOUND')
    if (claim.status !== 'APPROVED') throw new AppError('CONFLICT')
    claim.status = 'PAID'
    return publicClaim(claim)
  })
}
