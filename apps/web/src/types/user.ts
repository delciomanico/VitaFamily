/** Conta de acesso (docs/04-domain/entities.md → User). */
export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED'

export interface User {
  id: string
  email: string
  name: string
  /** Data ISO (yyyy-mm-dd). */
  birthDate: string
  /** Fuso IANA, referência dos lembretes (BR-ACC-04). */
  timezone: string
  status: UserStatus
}
