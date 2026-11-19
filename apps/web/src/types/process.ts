/**
 * Processo da família (`Process`, openapi.yaml; ADR-032). A API devolve só códigos; a UI traduz em `lib/labels.ts`.
 * Nunca traz motivo, valor, serviço, ou decisor (BR-PRC-12).
 */
export type ProcessFamilyStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'

export interface ProcessNextStep {
  code: string
  /** Conjunto aberto: `PROFESSIONAL` e `PLATFORM` são de marcações do mercado (MK3). */
  actor: 'FAMILY' | 'CLINIC' | 'NONE' | 'PROFESSIONAL' | 'PLATFORM'
}

export interface FamilyProcess {
  id: string
  memberId: string
  kind: string
  familyStatus: ProcessFamilyStatus
  nextStep: ProcessNextStep
  origin: { type: 'APPOINTMENT' | 'EXAMINATION' | 'BOOKING'; id: string }
  scheduledAt: string | null
  openedAt: string
}
