/**
 * Processo da família (`Process`, openapi.yaml; ADR-032/ADR-036). A API devolve só códigos; a UI traduz em `lib/labels.ts`.
 * Nunca traz motivo, valor, serviço, decisor nem rasto do pedido à seguradora (BR-PRC-12).
 */
export type ProcessFamilyStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'

/** Estado simples do pedido à seguradora (conjunto aberto: valores desconhecidos = sem bloco). */
export type ProcessCoverageState = 'PENDING' | 'NEEDS_INFO' | 'APPROVED' | 'NOT_APPROVED' | 'EXPIRED' | 'WITHDRAWN'

export interface ProcessCoverage {
  state: ProcessCoverageState
  /** Vem de uma nova análise (a UI diz «nova análise»). */
  appeal: boolean
  /** Aprovado em parte (sem valores). */
  partial: boolean
  dueAt?: string | null
  validUntil?: string | null
}

export interface ProcessNextStep {
  code: string
  actor: 'FAMILY' | 'CLINIC' | 'INSURER' | 'NONE'
  dueAt?: string | null
}

export interface FamilyProcess {
  id: string
  memberId: string
  kind: string
  familyStatus: ProcessFamilyStatus
  nextStep: ProcessNextStep
  /** Só para o titular/tutor (`MANAGE_INSURANCE`); `null`/ausente nos restantes. */
  coverage?: ProcessCoverage | null
  origin: { type: 'APPOINTMENT' | 'EXAMINATION' | 'AUTHORIZATION'; id: string }
  scheduledAt: string | null
  openedAt: string
}
