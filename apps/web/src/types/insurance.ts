/** `Insurer` (openapi.yaml): seguradora parceira gerida pelo Platform Admin (ADR-021, BR-ADM-05). */
export interface Insurer {
  id: string
  name: string
  taxId: string
  status: 'ACTIVE' | 'SUSPENDED'
}

/** `InsurerInput` / `InsurerPatch` (openapi.yaml). */
export interface InsurerInput {
  name: string
  taxId: string
}
export type InsurerPatch = Partial<InsurerInput>

export type InsuranceRole = 'INSURANCE_ADMIN' | 'INSURANCE_AGENT'

/** `InsuranceAccount` (openapi.yaml): conta do portal da seguradora (espaço de identidade próprio, ADR-021). */
export interface InsuranceAccount {
  id: string
  insurerId: string
  email: string
  role: InsuranceRole
  status: 'ACTIVE' | 'SUSPENDED'
}

/** Seguradora parceira ativa, escolhível na apólice (`GET /families/{f}/insurers`, BR-INS-09). */
export interface PartnerInsurer {
  id: string
  name: string
}

/** `InsurancePolicy` (openapi.yaml): cartão/apólice de um membro (BR-INS-01/02). */
export interface InsurancePolicy {
  id: string
  memberId: string
  insurerId: string | null
  insurerName: string
  policyNumber: string
  holderName: string
  validUntil: string | null
  cardDocumentId: string | null
  createdAt: string
}

export interface InsurancePolicyInput {
  insurerId: string | null
  insurerName: string
  policyNumber: string
  holderName: string
  validUntil: string | null
}

export type ClaimStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID'

/** `ReimbursementClaim` (openapi.yaml): pedido de reembolso (BR-INS-03..05). */
export interface ReimbursementClaim {
  id: string
  policyId: string
  amount: number
  currency: string
  status: ClaimStatus
  decisionNote: string | null
  documentIds: string[]
  createdAt: string
}

export interface ClaimInput {
  amount: number
  currency?: string
  documentIds: string[]
}

export const INSURANCE_TEXT_MAX = 200

/** Sessão do portal da seguradora (`InsuranceTokenResponse`, ADR-021). */
export interface InsuranceSession {
  insurerId: string
  role: InsuranceRole
  email?: string
}

/** `InsuranceClaimView` (openapi.yaml): o mínimo que a seguradora vê — nunca família nem membro (BR-INS-04/08). */
export interface InsuranceClaimView {
  id: string
  status: ClaimStatus
  amount: number
  currency: string
  policyHolderName: string
  policyNumber: string
  decisionNote: string | null
  documentIds: string[]
}

export type ClaimDecision = 'APPROVE' | 'REJECT'

export const insuranceRole: Record<InsuranceRole, string> = {
  INSURANCE_ADMIN: 'Admin da seguradora',
  INSURANCE_AGENT: 'Agente da seguradora',
}
