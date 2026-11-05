import * as mock from '@/mocks/handlers/insurance'
import { attachDocuments, validateUploads } from '@/mocks/documents'
import { db } from '@/mocks/db'
import { respond } from '@/mocks/respond'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { DocumentInfo, DocumentUpload } from '@/types/document'
import type {
  ClaimInput,
  InsurancePolicy,
  InsurancePolicyInput,
  PartnerInsurer,
  ReimbursementClaim,
} from '@/types/insurance'
import { apiListMemberDocuments, apiUploadDocuments } from './document.service'

/**
 * Cartão/apólice e pedidos de reembolso do titular (ADR-021, BR-INS-*). Só o próprio ou o tutor
 * (BR-INS-02). A foto do cartão segue o circuito de `documents` (`resourceType=INSURANCE_POLICY`).
 */

/** `InsurancePolicy` real (openapi.yaml): sem `memberId` — acrescentado aqui. */
type ApiPolicy = Omit<InsurancePolicy, 'memberId'>

const policiesPath = (familyId: string, memberId: string) =>
  `/families/${familyId}/members/${memberId}/insurance-policies`

const toPolicy = (memberId: string, policy: ApiPolicy): InsurancePolicy => ({ ...policy, memberId })

const apiImpl = {
  listInsurers: (familyId: string) => apiFetch<PartnerInsurer[]>(`/families/${familyId}/insurers`),
  async listPolicies(familyId: string, _userId: string, memberId: string) {
    return (await apiFetch<ApiPolicy[]>(policiesPath(familyId, memberId))).map((p) => toPolicy(memberId, p))
  },
  async createPolicy(familyId: string, _userId: string, memberId: string, input: InsurancePolicyInput) {
    return toPolicy(
      memberId,
      await apiFetch<ApiPolicy>(policiesPath(familyId, memberId), { method: 'POST', body: bodyOf(input) }),
    )
  },
  async updatePolicy(familyId: string, _userId: string, memberId: string, policyId: string, input: InsurancePolicyInput) {
    return toPolicy(
      memberId,
      await apiFetch<ApiPolicy>(`${policiesPath(familyId, memberId)}/${policyId}`, {
        method: 'PATCH',
        body: bodyOf(input),
      }),
    )
  },
  deletePolicy: (familyId: string, _userId: string, memberId: string, policyId: string) =>
    apiFetch<void>(`${policiesPath(familyId, memberId)}/${policyId}`, { method: 'DELETE' }),
  uploadCard: (familyId: string, memberId: string, policyId: string, upload: DocumentUpload) =>
    apiUploadDocuments(familyId, memberId, 'INSURANCE_POLICY', policyId, [upload]),
  listClaims: (familyId: string, _userId: string, memberId: string, policyId: string) =>
    apiFetch<ReimbursementClaim[]>(`${policiesPath(familyId, memberId)}/${policyId}/reimbursement-claims`),
  submitClaim: (familyId: string, _userId: string, memberId: string, policyId: string, input: ClaimInput) =>
    apiFetch<ReimbursementClaim>(`${policiesPath(familyId, memberId)}/${policyId}/reimbursement-claims`, {
      method: 'POST',
      body: { amount: input.amount, currency: input.currency ?? 'EUR', documentIds: input.documentIds },
    }),
  markClaimPaid: (familyId: string, _userId: string, memberId: string, policyId: string, claimId: string) =>
    apiFetch<ReimbursementClaim>(`${policiesPath(familyId, memberId)}/${policyId}/reimbursement-claims/${claimId}/paid`, {
      method: 'PUT',
    }),
  listMemberDocuments: apiListMemberDocuments,
}

function bodyOf(input: InsurancePolicyInput) {
  return {
    insurerId: input.insurerId,
    insurerName: input.insurerName.trim(),
    policyNumber: input.policyNumber.trim(),
    holderName: input.holderName.trim(),
    validUntil: input.validUntil,
  }
}

const mockImpl = {
  listInsurers: (_familyId: string) => mock.listPartnerInsurers(),
  listPolicies: mock.listInsurancePolicies,
  createPolicy: mock.createInsurancePolicy,
  updatePolicy: mock.updateInsurancePolicy,
  deletePolicy: mock.deleteInsurancePolicy,
  /** Substitui a foto anterior: a apólice tem um só cartão. */
  uploadCard: (familyId: string, memberId: string, policyId: string, upload: DocumentUpload) =>
    respond(() => {
      validateUploads([upload])
      db.documents = db.documents.filter((d) => !(d.resourceType === 'INSURANCE_POLICY' && d.resourceId === policyId))
      attachDocuments([upload], { familyId, memberId, resourceType: 'INSURANCE_POLICY', resourceId: policyId }, new Date())
      return undefined
    }),
  listClaims: mock.listReimbursementClaims,
  submitClaim: mock.submitReimbursementClaim,
  markClaimPaid: mock.markReimbursementClaimPaid,
  listMemberDocuments: (familyId: string, memberId: string): Promise<DocumentInfo[]> =>
    respond(() => db.documents.filter((d) => d.familyId === familyId && d.memberId === memberId)),
}

export const insuranceService = hasApiBackend() ? apiImpl : mockImpl
