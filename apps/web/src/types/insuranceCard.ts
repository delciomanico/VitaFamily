import type { BeneficiaryStatus, InsurerCoverageLimits, LinkRequestStatus } from './insurerOps'

/**
 * Cartão digital e reclamação de cartão no app do paciente (Fase A, S6; ADR-025, BR-SEG-20).
 * Tipos escritos à mão a partir de `docs/05-api/openapi.yaml`
 * (`/families/{f}/members/{m}/insurance/{card-claims,cards}`).
 */

export interface InsuranceCardClaimRequest {
  insurerId: string
  policyNumber: string
  code: string
}

export interface InsuranceCardClaim {
  id: string
  insurerId: string
  insurerName: string
  /** Só depois de `CONFIRMED`. */
  beneficiaryId?: string | null
  status: LinkRequestStatus
  requestedAt: string
  decidedAt?: string | null
  /** Motivo da rejeição, escrito pela seguradora. */
  decisionNote?: string | null
}

export interface InsuranceCard {
  beneficiaryId: string
  insurerId: string
  insurerName: string
  /** ISO 4217 da seguradora (BR-SEG-19). */
  currency: string
  beneficiaryName: string
  cardNumber: string
  status: BeneficiaryStatus
  planName?: string | null
  policyNumber?: string | null
  validFrom?: string | null
  validTo?: string | null
}

export interface InsuranceCardQr {
  token: string
  expiresAt: string
  cardVersion: number
}

/** Fase A (D-A2): cobertura e limites anuais, sem «usado»/«reservado»/saldo. */
export interface InsuranceCardCoverage {
  beneficiaryId: string
  insurerId: string
  currency: string
  status: BeneficiaryStatus
  planName?: string | null
  policyNumber?: string | null
  validFrom?: string | null
  validTo?: string | null
  coverages: InsurerCoverageLimits[]
}

/** Validade do QR do cartão (BR-SEG-18): a app mostra a contagem decrescente e deixa renovar. */
export const CARD_QR_TTL_SECONDS = 120

export const cardClaimStatusLabel: Record<LinkRequestStatus, string> = {
  PENDING: 'A aguardar confirmação',
  CONFIRMED: 'Confirmado',
  REJECTED: 'Rejeitado',
  REVOKED: 'Desligado',
}

export const cardStatusLabel: Record<BeneficiaryStatus, string> = {
  PENDING: 'Pendente',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  CANCELLED: 'Cancelado',
}
