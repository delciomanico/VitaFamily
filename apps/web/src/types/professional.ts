/**
 * Tipos do portal do profissional (`/professional-portal/*`) e da validação pelo admin
 * (`/admin/professionals*`, `/admin/specialties*`), alinhados com `docs/05-api/openapi.yaml` (MK1, ADR-037).
 * Sem dados de saúde nem de família: o mercado de profissionais é um espaço de identidade separado.
 */

export type ProfessionalValidationStatus = 'DRAFT' | 'PENDING_REVIEW' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'

export type SpecialtyCategory = 'HEALTH' | 'WELLNESS'

export interface Specialty {
  id: string
  name: string
  category: SpecialtyCategory
}

export interface AdminSpecialty extends Specialty {
  active: boolean
  /** Profissionais que a usam, em qualquer estado. */
  professionalCount: number
}

export interface SpecialtyInput {
  name: string
  category: SpecialtyCategory
}

export type SpecialtyPatch = Partial<SpecialtyInput & { active: boolean }>

export type ProfessionalRequirement =
  | 'DISPLAY_NAME'
  | 'CITY'
  | 'SPECIALTY'
  | 'CREDENTIAL_IDENTITY'
  | 'CREDENTIAL_PROFESSIONAL_LICENSE'
  | 'CREDENTIAL_CERTIFICATION'
  | 'CREDENTIAL_SCAN_PENDING'
  | 'CREDENTIAL_INFECTED'
  | 'CREDENTIAL_EXPIRED'

export interface ProfessionalProfile {
  id: string
  email: string
  displayName?: string
  bio?: string
  city?: string
  /** Texto livre; nunca exposto em pesquisa nem perfil público, nem ao admin (BR-MKT-26). */
  paymentInstructions?: string
  validationStatus: ProfessionalValidationStatus
  statusReason?: string
  statusChangedAt: string
  submittedAt?: string
  approvedAt?: string
  specialties: Specialty[]
  requirements: { canSubmit: boolean; missing: ProfessionalRequirement[] }
}

/** `null` apaga o campo opcional; `displayName`/`city` não aceitam `null` no contrato. */
export interface ProfessionalProfilePatch {
  displayName?: string
  bio?: string | null
  city?: string
  paymentInstructions?: string | null
}

export type CredentialKind = 'IDENTITY' | 'PROFESSIONAL_LICENSE' | 'CERTIFICATION'
export type CredentialScanStatus = 'PENDING' | 'CLEAN' | 'INFECTED'
export type CredentialContentType = 'application/pdf' | 'image/jpeg' | 'image/png'

export interface ProfessionalCredential {
  id: string
  kind: CredentialKind
  number?: string
  issuingBody?: string
  /** yyyy-mm-dd */
  validUntil?: string
  scanStatus: CredentialScanStatus
  contentType: CredentialContentType
  sizeBytes: number
  createdAt: string
}

export interface CredentialUploadInput {
  kind: CredentialKind
  number?: string
  issuingBody?: string
  validUntil?: string
  file: File
}

export type OfferMethod = 'IN_PERSON' | 'VIDEO' | 'CHAT' | 'PHONE'
export const OFFER_DURATIONS = [15, 20, 30, 45, 60] as const
export type OfferDuration = (typeof OFFER_DURATIONS)[number]
export const MAX_PRICE_KZ = 100_000_000

export interface ProfessionalOffer {
  id: string
  specialtyId: string
  method: OfferMethod
  durationMinutes: OfferDuration
  /** Kwanza inteiro, sem cêntimos (BR-MKT-24, BR-MKT-31). */
  priceKz: number
  note?: string
  active: boolean
}

export interface ProfessionalOfferInput {
  specialtyId: string
  method: OfferMethod
  durationMinutes: OfferDuration
  priceKz: number
  note?: string | null
}

export interface ProfessionalOfferPatch {
  priceKz?: number
  note?: string | null
  active?: boolean
}

/** ISO: 1 = segunda … 7 = domingo. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface ProfessionalScheduleRule {
  id: string
  offerId: string
  weekdays: Weekday[]
  /** HH:mm, hora local de Africa/Luanda. */
  startTime: string
  endTime: string
  validFrom?: string
  validUntil?: string
  active: boolean
}

export interface ProfessionalScheduleRuleInput {
  offerId: string
  weekdays: Weekday[]
  startTime: string
  endTime: string
  validFrom?: string | null
  validUntil?: string | null
}

export interface ProfessionalScheduleRulePatch {
  weekdays?: Weekday[]
  startTime?: string
  endTime?: string
  validFrom?: string | null
  validUntil?: string | null
  active?: boolean
}

export interface ProfessionalScheduleGeneration {
  created: number
  unchanged: number
  removed: number
  skippedOverlap: number
  skippedTimeOff: number
}

export interface ProfessionalScheduleRuleResult {
  rule: ProfessionalScheduleRule
  generation: ProfessionalScheduleGeneration
}

export interface ProfessionalTimeOff {
  id: string
  startsAt: string
  endsAt: string
  /** Nota interna; fora de auditoria e logs. */
  reason?: string
}

export interface ProfessionalTimeOffInput {
  startsAt: string
  endsAt: string
  reason?: string | null
}

export interface ProfessionalSlot {
  id: string
  offerId: string
  startsAt: string
  endsAt: string
}

/** `ProfessionalTokenResponse` reduzido ao que a UI guarda (o token vive só em memória). */
export interface ProfessionalSession {
  professionalId: string
  email: string
  validationStatus: ProfessionalValidationStatus
}

export interface ProfessionalRegisterInput {
  email: string
  password: string
  termsVersion: string
}

export type ValidationAction = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'NEEDS_INFO' | 'SUSPENDED' | 'REACTIVATED' | 'EXPIRED'

export interface ValidationCase {
  id: string
  action: ValidationAction
  fromStatus: ProfessionalValidationStatus
  toStatus: ProfessionalValidationStatus
  actor: 'PROFESSIONAL' | 'PLATFORM_ADMIN' | 'SYSTEM'
  reason?: string
  createdAt: string
}

export interface AdminProfessionalItem {
  id: string
  displayName?: string
  email: string
  validationStatus: ProfessionalValidationStatus
  submittedAt?: string
  specialties: Specialty[]
  credentialCount: number
  createdAt: string
}

export interface AdminProfessionalPage {
  items: AdminProfessionalItem[]
  nextCursor: string | null
}

export interface AdminProfessionalFilters {
  status?: ProfessionalValidationStatus
  category?: SpecialtyCategory
  q?: string
  cursor?: string
}

/** Nunca inclui `paymentInstructions` nem dados de saúde (BR-MKT-26/27). */
export interface AdminProfessionalDetail {
  id: string
  email: string
  emailVerifiedAt?: string
  displayName?: string
  bio?: string
  city?: string
  validationStatus: ProfessionalValidationStatus
  statusReason?: string
  statusChangedAt: string
  submittedAt?: string
  approvedAt?: string
  specialties: Specialty[]
  credentials: ProfessionalCredential[]
  /** Mais recente primeiro. */
  history: ValidationCase[]
  createdAt: string
}

export type ProfessionalDecision = 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'SUSPEND' | 'REACTIVATE'

export interface ProfessionalDecisionInput {
  decision: ProfessionalDecision
  /** Obrigatório em REJECT, REQUEST_INFO e SUSPEND (máx. 500). */
  reason?: string
}
