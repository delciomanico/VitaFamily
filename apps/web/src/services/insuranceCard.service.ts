import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { asArray } from '@/lib/safe'
import * as mock from '@/mocks/handlers/insuranceCards'
import type {
  InsuranceCard,
  InsuranceCardClaim,
  InsuranceCardClaimRequest,
  InsuranceCardCoverage,
  InsuranceCardQr,
} from '@/types/insuranceCard'

/**
 * Reclamar cartão, cartão digital, QR e cobertura do membro (ADR-025 Fase A, S6). Só o próprio ou o tutor
 * (BR-INS-02). O QR não se guarda: cada pedido emite um token novo, de validade curta (BR-SEG-18).
 */
const base = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}/insurance`

const apiImpl = {
  listClaims: async (familyId: string, _userId: string, memberId: string) =>
    asArray(await apiFetch<InsuranceCardClaim[]>(`${base(familyId, memberId)}/card-claims`)),
  claim: (familyId: string, _userId: string, memberId: string, input: InsuranceCardClaimRequest) =>
    apiFetch<InsuranceCardClaim>(`${base(familyId, memberId)}/card-claims`, {
      method: 'POST',
      body: { insurerId: input.insurerId, policyNumber: input.policyNumber.trim(), code: input.code.trim() },
    }),
  revoke: (familyId: string, _userId: string, memberId: string, claimId: string) =>
    apiFetch<void>(`${base(familyId, memberId)}/card-claims/${claimId}`, { method: 'DELETE' }),
  listCards: async (familyId: string, _userId: string, memberId: string) =>
    asArray(await apiFetch<InsuranceCard[]>(`${base(familyId, memberId)}/cards`)),
  getQr: (familyId: string, _userId: string, memberId: string, beneficiaryId: string) =>
    apiFetch<InsuranceCardQr>(`${base(familyId, memberId)}/cards/${beneficiaryId}/qr`),
  getCoverage: (familyId: string, _userId: string, memberId: string, beneficiaryId: string) =>
    apiFetch<InsuranceCardCoverage>(`${base(familyId, memberId)}/cards/${beneficiaryId}/coverage`),
}

const mockImpl = {
  listClaims: (familyId: string, userId: string, memberId: string) => mock.listCardClaims(familyId, userId, memberId),
  claim: (familyId: string, userId: string, memberId: string, input: InsuranceCardClaimRequest) =>
    mock.claimCard(familyId, userId, memberId, input),
  revoke: (familyId: string, userId: string, memberId: string, claimId: string) =>
    mock.revokeCardClaim(familyId, userId, memberId, claimId),
  listCards: (familyId: string, userId: string, memberId: string) => mock.listCards(familyId, userId, memberId),
  getQr: (familyId: string, userId: string, memberId: string, beneficiaryId: string) =>
    mock.getCardQr(familyId, userId, memberId, beneficiaryId),
  getCoverage: (familyId: string, userId: string, memberId: string, beneficiaryId: string) =>
    mock.getCardCoverage(familyId, userId, memberId, beneficiaryId),
}

export const insuranceCardService = hasApiBackend() ? apiImpl : mockImpl
