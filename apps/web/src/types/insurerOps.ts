/**
 * Módulo operacional de seguradoras, Fase A (ADR-025; docs/11-implementation/insurer-phase-a.md).
 * Tipos escritos à mão a partir de `docs/05-api/openapi.yaml` (o web não gera tipos do OpenAPI).
 */

/** Página de listagem com cursor (`{ items, nextCursor }`). */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface InsurerCompany {
  id: string
  name: string
  taxId: string
  status: 'ACTIVE' | 'INACTIVE'
  createdAt: string
}

export type BeneficiaryStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'
export type BeneficiaryRelationship = 'HOLDER' | 'SPOUSE' | 'CHILD' | 'OTHER'

/** `InsurerBeneficiary`: nunca traz ids de família/membro, só `linked` (BR-SEG-20). */
export interface InsurerBeneficiary {
  id: string
  companyId?: string | null
  holderId?: string | null
  name: string
  idDocumentType: string
  idDocumentNumber: string
  birthDate: string
  relationship: BeneficiaryRelationship
  cardNumber: string
  status: BeneficiaryStatus
  linked: boolean
  statusNote?: string | null
  createdAt: string
}

export interface InsurerBeneficiaryInput {
  companyId?: string
  holderId?: string
  name: string
  idDocumentType: string
  idDocumentNumber: string
  birthDate: string
  relationship: BeneficiaryRelationship
}

export interface InsurerBeneficiaryPatch {
  name?: string
  birthDate?: string
  companyId?: string | null
}

export interface InsurerClaimCode {
  code: string
  expiresAt: string
}

export type ImportRowErrorCode =
  | 'REQUIRED'
  | 'INVALID_FORMAT'
  | 'INVALID_VALUE'
  | 'DUPLICATE_IN_FILE'
  | 'DUPLICATE_EXISTING'
  | 'HOLDER_NOT_FOUND'
  | 'COMPANY_NOT_FOUND'

export interface InsurerImportRowError {
  row: number
  field?: string | null
  code: ImportRowErrorCode
  message?: string
}

export interface InsurerImportPreviewRow {
  row: number
  name: string
  idDocumentType: string
  idDocumentNumber: string
  birthDate: string
  relationship: BeneficiaryRelationship
}

export type ImportStatus = 'PREVIEW' | 'COMMITTED' | 'FAILED' | 'CANCELLED'

export interface InsurerImport {
  id: string
  format: 'CSV' | 'XLSX'
  status: ImportStatus
  rowCount: number
  validRows: number
  errorRows: number
  duplicateRows: number
  importedRows?: number | null
  errors: InsurerImportRowError[]
  errorsTruncated: boolean
  preview: InsurerImportPreviewRow[]
  createdAt: string
}

export type LinkRequestStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'REVOKED'

export interface InsurerLinkRequest {
  id: string
  beneficiaryId: string
  beneficiaryName: string
  cardNumber: string
  status: LinkRequestStatus
  requestedAt: string
  decidedAt?: string | null
  decisionNote?: string | null
}

export type PolicyStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELLED'

export interface InsurerPolicy {
  id: string
  number: string
  planId: string
  planName: string
  planVersion: number
  companyId?: string | null
  holderId: string
  validFrom: string
  validTo: string
  status: PolicyStatus
  statusNote?: string | null
  createdAt: string
}

export interface InsurerPolicyInput {
  planId: string
  holderId: string
  companyId?: string
  number: string
  validFrom: string
  validTo: string
}

export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'

export interface InsurerPlan {
  id: string
  name: string
  version: number
  status: PlanStatus
  coverageCount: number
  createdAt: string
}

export interface InsurerPlanCoverage {
  serviceId: string
  serviceCode: string
  serviceName: string
  covered: boolean
  copayPct: number
  limitPerYear?: number | null
  waitingDays: number
  requiresAuthorization: boolean
}

export interface InsurerPlanCoverageInput {
  serviceId: string
  covered: boolean
  copayPct: number
  limitPerYear: number | null
  waitingDays: number
  requiresAuthorization: boolean
}

export interface InsurerService {
  id: string
  code: string
  name: string
  category?: string | null
  status: 'ACTIVE' | 'INACTIVE'
}

export interface InsurerServiceInput {
  code: string
  name: string
  category?: string
}

export interface InsurerServicePatch {
  name?: string
  category?: string | null
  status?: 'ACTIVE' | 'INACTIVE'
}

export interface PartnerClinic {
  id: string
  name: string
}

export interface InsurerProvider {
  id: string
  clinicId: string | null
  name: string
  status: 'ACTIVE' | 'SUSPENDED'
}

/** Seguradora a que a clínica está ligada (`ClinicInsurer`). `currency` é ISO 4217 (BR-SEG-19). */
export interface ClinicInsurer {
  id: string
  name: string
  currency: string
}

/** Exatamente um de `cardNumber`, `qrToken`, `idDocument` (BR-SEG-18). */
export interface InsurerEligibilityRequest {
  cardNumber?: string
  qrToken?: string
  idDocument?: { type: string; number: string }
  serviceCode?: string
}

export interface InsurerCoverageLimits {
  serviceCode: string
  serviceName: string
  coveredNow: boolean
  copayPct: number
  limitPerYear?: number | null
  waitingDays: number
  waitingEndsOn?: string | null
  requiresAuthorization: boolean
}

export interface InsurerEligibilityResult {
  eligible: boolean
  notice: string
  beneficiaryName?: string
  status?: 'ACTIVE'
  planName?: string
  validFrom?: string
  validTo?: string
  currency?: string
  coverages?: InsurerCoverageLimits[]
  /** Marco B fatia 3 (BR-SEG-43): semáforo do serviço pedido; só com `serviceCode`. */
  light?: EligibilityLight
  /** Copagamento: % que o paciente paga no balcão; nulo se VERMELHO. */
  patientSharePct?: number | null
}

export type EligibilityLight = 'GREEN' | 'YELLOW' | 'RED'

/** Pedido de autorização do prestador (S4 simplificado, ADR-034). */
export type AuthorizationStatus = 'SUBMITTED' | 'IN_REVIEW' | 'INFO_REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
export type AuthorizationAction = 'RESPOND' | 'CANCEL' | 'APPEAL' | 'ATTACH'
/** Só documentos administrativos (BR-AUT-13). */
export type AuthorizationAttachmentKind = 'QUOTE' | 'INSURER_FORM' | 'ID_COPY' | 'OTHER_ADMIN'

export interface AuthorizationAttachment {
  id: string
  kind: AuthorizationAttachmentKind
  originalName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export interface AuthorizationRequest {
  id: string
  insurerId: string
  insurerName: string
  beneficiaryName: string
  serviceCode: string
  serviceName: string
  guideType: string
  currency: string
  requestedAmount: number
  authorizedAmount?: number | null
  partial?: boolean
  expectedOn: string
  justification: string
  status: AuthorizationStatus
  closedReason?: 'INFO_TIMEOUT' | 'CLINIC_CANCELLED' | 'ANALYST_CANCELLED' | null
  decisionNote?: string | null
  code?: string | null
  validUntil?: string | null
  decisionDueAt?: string | null
  infoExpiresAt?: string | null
  appealOpenUntil?: string | null
  processId?: string | null
  parentRequestId?: string | null
  allowedActions: AuthorizationAction[]
  attachments?: AuthorizationAttachment[]
  timeline?: Array<{ status: AuthorizationStatus; occurredAt: string; by: 'CLINIC' | 'INSURER' | 'SYSTEM'; note?: string | null }>
  createdAt: string
  updatedAt: string
}

/** `AuthorizationRequestInput` (sem campos clínicos, C2). */
export interface AuthorizationRequestInput extends InsurerEligibilityRequest {
  insurerId: string
  serviceCode: string
  guideType?: string
  requestedAmount: number
  expectedOn: string
  justification: string
  processId?: string
}

export interface ClinicInsurerService {
  code: string
  name: string
  category?: string | null
  /** Marco B fatia 2: tipo de guia deduzido do serviço (nulo/ausente = por classificar). */
  guideType?: string | null
}

export const beneficiaryStatusLabel: Record<BeneficiaryStatus, string> = {
  PENDING: 'Pendente',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  CANCELLED: 'Cancelado',
}

export const relationshipLabel: Record<BeneficiaryRelationship, string> = {
  HOLDER: 'Titular',
  SPOUSE: 'Cônjuge',
  CHILD: 'Filho(a)',
  OTHER: 'Outro',
}

export const policyStatusLabel: Record<PolicyStatus, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  EXPIRED: 'Expirada',
  CANCELLED: 'Cancelada',
}

export const planStatusLabel: Record<PlanStatus, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativo',
  ARCHIVED: 'Arquivado',
}

export const linkStatusLabel: Record<LinkRequestStatus, string> = {
  PENDING: 'Por decidir',
  CONFIRMED: 'Confirmada',
  REJECTED: 'Rejeitada',
  REVOKED: 'Revogada',
}

export const importRowErrorLabel: Record<ImportRowErrorCode, string> = {
  REQUIRED: 'Campo obrigatório em falta',
  INVALID_FORMAT: 'Formato inválido',
  INVALID_VALUE: 'Valor inválido',
  DUPLICATE_IN_FILE: 'Repetido no ficheiro',
  DUPLICATE_EXISTING: 'Documento já existe na seguradora',
  HOLDER_NOT_FOUND: 'Titular não encontrado',
  COMPANY_NOT_FOUND: 'Empresa não encontrada',
}
