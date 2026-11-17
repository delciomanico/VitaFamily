import type {
  CredentialKind,
  CredentialScanStatus,
  OfferMethod,
  ProfessionalDecision,
  ProfessionalRequirement,
  ProfessionalValidationStatus,
  SpecialtyCategory,
  ValidationAction,
  Weekday,
} from '@/types/professional'
import type { Tone } from '@/components/ui/Badge'

/** Textos em pt-PT do mercado de profissionais (UC-MKT-12) e regras de edição (authorization.md §10.2). */

/** Linguagem simples do estado de validação (UC-MKT-12). */
export const validationStatusLabel: Record<ProfessionalValidationStatus, string> = {
  DRAFT: 'A preencher',
  PENDING_REVIEW: 'Em análise',
  NEEDS_INFO: 'Falta informação',
  APPROVED: 'Aprovado e visível',
  REJECTED: 'Rejeitado',
  SUSPENDED: 'Suspenso',
}

export const validationStatusTone: Record<ProfessionalValidationStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'primary',
  NEEDS_INFO: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
}

export const validationStatusHint: Record<ProfessionalValidationStatus, string> = {
  DRAFT: 'Preencha o perfil e carregue as credenciais; depois submeta para validação.',
  PENDING_REVIEW: 'A equipa está a analisar o seu perfil. Não é possível alterar o nome, as especialidades nem as credenciais.',
  NEEDS_INFO: 'A equipa pediu mais informação. Corrija o que falta e submeta de novo.',
  APPROVED: 'O seu perfil está aprovado. Ofertas, preços e horários podem ser alterados; o nome, as especialidades e as credenciais ficam bloqueados.',
  REJECTED: 'O perfil foi rejeitado. Está em modo só de leitura.',
  SUSPENDED: 'O perfil foi suspenso. Está em modo só de leitura.',
}

export const requirementLabel: Record<ProfessionalRequirement, string> = {
  DISPLAY_NAME: 'nome de apresentação',
  CITY: 'cidade',
  SPECIALTY: 'pelo menos uma especialidade',
  CREDENTIAL_IDENTITY: 'documento de identificação',
  CREDENTIAL_PROFESSIONAL_LICENSE: 'cédula profissional',
  CREDENTIAL_CERTIFICATION: 'certificação',
  CREDENTIAL_SCAN_PENDING: 'credencial ainda em verificação',
  CREDENTIAL_INFECTED: 'credencial rejeitada pelo antivírus (remova e carregue outra)',
  CREDENTIAL_EXPIRED: 'credencial caducada',
}

export const credentialKindLabel: Record<CredentialKind, string> = {
  IDENTITY: 'Identificação',
  PROFESSIONAL_LICENSE: 'Cédula / inscrição profissional',
  CERTIFICATION: 'Certificação',
}

export const scanStatusLabel: Record<CredentialScanStatus, string> = {
  PENDING: 'Em verificação',
  CLEAN: 'Verificada',
  INFECTED: 'Rejeitada (antivírus)',
}

export const scanStatusTone: Record<CredentialScanStatus, Tone> = { PENDING: 'warning', CLEAN: 'success', INFECTED: 'danger' }

export const offerMethodLabel: Record<OfferMethod, string> = {
  IN_PERSON: 'Presencial',
  VIDEO: 'Vídeo',
  CHAT: 'Chat',
  PHONE: 'Telefone',
}

export const categoryLabel: Record<SpecialtyCategory, string> = { HEALTH: 'Saúde', WELLNESS: 'Bem-estar' }

export const validationActionLabel: Record<ValidationAction, string> = {
  SUBMITTED: 'Submetido',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  NEEDS_INFO: 'Informação pedida',
  SUSPENDED: 'Suspenso',
  REACTIVATED: 'Reativado',
  EXPIRED: 'Credencial caducada',
}

export const decisionLabel: Record<ProfessionalDecision, string> = {
  APPROVE: 'Aprovar',
  REJECT: 'Rejeitar',
  REQUEST_INFO: 'Pedir informação',
  SUSPEND: 'Suspender',
  REACTIVATE: 'Reativar',
}

/** Decisões possíveis por estado (state-machines.md); as que exigem motivo estão em `DECISIONS_NEEDING_REASON`. */
export const decisionsFor: Record<ProfessionalValidationStatus, ProfessionalDecision[]> = {
  DRAFT: [],
  PENDING_REVIEW: ['APPROVE', 'REJECT', 'REQUEST_INFO'],
  NEEDS_INFO: [],
  APPROVED: ['SUSPEND', 'REQUEST_INFO'],
  REJECTED: ['REQUEST_INFO'],
  SUSPENDED: ['REACTIVATE'],
}

export const DECISIONS_NEEDS_REASON: ProfessionalDecision[] = ['REJECT', 'REQUEST_INFO', 'SUSPEND']

/** Dias ISO (1 = segunda … 7 = domingo). */
export const weekdayLabel: Record<Weekday, string> = {
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
  7: 'Domingo',
}
export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]

/**
 * Permissões de escrita por estado de validação (authorization.md §10.2, OP-59/OP-62). A decisão real é
 * do servidor (`PROFESSIONAL_LOCKED`); isto só evita oferecer ações que seriam recusadas.
 */
export function editRights(status: ProfessionalValidationStatus) {
  const readOnly = status === 'REJECTED' || status === 'SUSPENDED'
  return {
    /** Nome de apresentação, especialidades e credenciais. */
    identity: status === 'DRAFT' || status === 'NEEDS_INFO',
    /** Bio, cidade e instruções de pagamento. */
    profileText: !readOnly,
    /** Ofertas, regras de horário e bloqueios. */
    commercial: !readOnly,
    submit: status === 'DRAFT' || status === 'NEEDS_INFO',
    readOnly,
  }
}

const kzFormat = new Intl.NumberFormat('pt-AO', { maximumFractionDigits: 0 })

/** Kwanza inteiro: «15 000 Kz» (BR-MKT-24). */
export function formatKz(amount: number): string {
  return `${kzFormat.format(amount)} Kz`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

export const CREDENTIAL_MAX_BYTES = 10 * 1024 * 1024
export const CREDENTIAL_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
