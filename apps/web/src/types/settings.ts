import type { PublicMember } from './family'
import type { SharingCategory } from './sharing'

/** Canais e tipos de alerta do utilizador (UC-ALR-05; openapi → NotificationPreferences). */
export interface NotificationPreferences {
  pushEnabled: boolean
  emailEnabled: boolean
  medicationDue: boolean
  appointmentReminder: boolean
  examReminder: boolean
}

/** Valores por defeito de R9: tudo ativo. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  emailEnabled: true,
  medicationDue: true,
  appointmentReminder: true,
  examReminder: true,
}

/** Concessão de leitura numa categoria; sem destinatário = toda a família. */
export interface SharingRule {
  category: SharingCategory
  granteeMemberId?: string
}

/** Partilha de um membro (UC-PRV-01; openapi → SharingSettings). */
export interface SharingSettings {
  member: PublicMember
  grants: SharingRule[]
  /** Outros membros da família a quem se pode partilhar. */
  others: PublicMember[]
}

/** O que outros membros partilham comigo (UC-PRV-02; openapi → SharedWithMeItem). */
export interface SharedWithMeItem {
  memberId: string
  memberName: string
  categories: SharingCategory[]
}

/** Exportação dos meus dados (UC-ACC-06; openapi → DataExport). */
export interface DataExport {
  id: string
  status: 'PENDING' | 'READY' | 'EXPIRED' | 'FAILED'
  reason: 'USER_REQUEST'
  requestedAt: string
  expiresAt?: string
}

export interface UpdateAccountInput {
  name: string
  timezone: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}
