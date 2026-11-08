/*
 * Recibos da clínica, perfil e auditoria (M14 R, BR-CLN-31..40). Dinheiro sempre em cêntimos
 * inteiros; a moeda é a da clínica no momento da emissão (sem conversão, BR-CLN-34).
 */

export type ReceiptStatus = 'ISSUED' | 'VOIDED'
export type ReceiptPaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'INSURANCE'
export type ReceiptBookingKind = 'APPOINTMENT' | 'EXAM' | 'VISIT'

export const RECEIPT_NOTICE = 'Documento não fiscal — não substitui fatura'
export const RECEIPT_MAX_LINES = 20
export const RECEIPT_MAX_MINOR = 100_000_000_000
export const RECEIPT_NOTE_MAX = 200
export const RECEIPT_DESCRIPTION_MAX = 120
export const RECEIPT_VOID_REASON_MIN = 3
export const RECEIPT_VOID_REASON_MAX = 200

/** `ClinicReceiptLine`: `serviceTypeId` nulo em linhas livres. */
export interface ClinicReceiptLine {
  position: number
  description: string
  amountMinor: number
  serviceTypeId: string | null
}

/** Retrato do perfil da clínica na emissão (BR-CLN-31). */
export interface ClinicReceiptIssuer {
  name: string
  address: string | null
  phone: string | null
  email: string | null
}

/** `ClinicReceipt` (openapi.yaml): imutável salvo a anulação; sem ids Vita. */
export interface ClinicReceipt {
  id: string
  number: number
  bookingKind: ReceiptBookingKind
  bookingId: string
  status: ReceiptStatus
  paymentMethod: ReceiptPaymentMethod
  currency: string
  totalMinor: number
  patientName: string
  note: string | null
  issuer: ClinicReceiptIssuer
  lines: ClinicReceiptLine[]
  issuedAt: string
  issuedByClinicAccountId: string | null
  voidedAt: string | null
  /** Interno da clínica; nunca vai ao paciente nem à seguradora. */
  voidReason: string | null
  voidedByClinicAccountId: string | null
  notice: string
  availableToPatient: boolean
}

/** `ClinicReceiptLineInput`: do catálogo (`serviceTypeId`, `amountMinor` opcional ajusta) ou livre. */
export interface ClinicReceiptLineInput {
  serviceTypeId?: string
  description?: string
  amountMinor?: number
}

export interface ClinicReceiptInput {
  bookingKind: ReceiptBookingKind
  bookingId: string
  paymentMethod: ReceiptPaymentMethod
  /** Omitido ⇒ uma linha com o serviço do horário (um toque). */
  lines?: ClinicReceiptLineInput[]
  note?: string
}

/** Totais do período inteiro; anulados não somam (BR-CLN-37). */
export interface ClinicReceiptSummary {
  issuedCount: number
  issuedTotalMinor: number
  voidedCount: number
  currency: string
}

export interface ClinicReceiptPage {
  items: ClinicReceipt[]
  nextCursor: string | null
  summary: ClinicReceiptSummary
}

export interface ClinicReceiptQuery {
  /** Dias locais inclusivos (yyyy-mm-dd), ambos obrigatórios, ≤ 366 dias. */
  from: string
  to: string
  status?: ReceiptStatus
  limit?: number
  cursor?: string
}

/** `FamilyClinicReceipt` (BR-CLN-35): cópia do paciente, sem motivo da anulação nem ids da clínica. */
export interface FamilyClinicReceipt {
  id: string
  number: number
  clinicName: string
  clinicAddress: string | null
  clinicPhone: string | null
  status: ReceiptStatus
  paymentMethod: ReceiptPaymentMethod
  currency: string
  totalMinor: number
  patientName: string
  note: string | null
  lines: Array<Pick<ClinicReceiptLine, 'description' | 'amountMinor'>>
  issuedAt: string
  voidedAt: string | null
  notice: string
  /** Pedidos de reembolso do membro a que está anexado. */
  attachedToClaimIds: string[]
}

export interface FamilyClinicReceiptPage {
  items: FamilyClinicReceipt[]
  nextCursor: string | null
}

/** `ClinicProfile` (BR-CLN-38): `name` e `currency` só leitura. */
export interface ClinicProfile {
  name: string
  displayName: string | null
  address: string | null
  phone: string | null
  email: string | null
  openingHours: string | null
  description: string | null
  currency: string
}

export type ClinicProfileField = 'displayName' | 'address' | 'phone' | 'email' | 'openingHours' | 'description'

/** Parcial; `null` limpa o campo. */
export type ClinicProfileInput = Partial<Record<ClinicProfileField, string | null>>

export const PROFILE_LIMITS: Record<ClinicProfileField, number> = {
  displayName: 120,
  address: 200,
  phone: 30,
  email: 254,
  openingHours: 500,
  description: 500,
}

/** `ClinicAuditEntry` (BR-CLN-40): sem ip, user agent, metadados, e-mails nem nomes. */
export interface ClinicAuditEntry {
  id: string
  occurredAt: string
  action: string
  resourceType: string
  resourceId: string | null
  result: 'SUCCESS' | 'DENIED' | 'FAILURE'
  actorAccountId: string | null
}

export interface ClinicAuditPage {
  items: ClinicAuditEntry[]
  nextCursor: string | null
}

export interface ClinicAuditQuery {
  from?: string
  to?: string
  action?: string
  actorAccountId?: string
  limit?: number
  cursor?: string
}
