import type { ConsentLevel } from './clinic'

/** `ClinicConsent` (BR-CLN-19): o que uma clínica parceira pode ver do membro (quem vê o quê). */
export interface ClinicConsent {
  clinicId: string
  clinicName: string
  /** Nível efetivo: um HISTORY expirado aparece como BOOKINGS com `renewalNeeded`. */
  level: ConsentLevel
  /** Fim da validade do HISTORY (12 meses); nulo em BOOKINGS. */
  validUntil: string | null
  renewalNeeded: boolean
  /** A clínica já tem um paciente ligado a este membro. */
  linked: boolean
}

/** `ClinicLinkCode` (BR-CLN-20): 8 caracteres, uso único, 10 minutos. */
export interface ClinicLinkCode {
  code: string
  expiresAt: string
}

/** Alfabeto sem 0/O/1/I/L e validade do código (BR-CLN-20). */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const LINK_CODE_TTL_MS = 10 * 60_000
/** Validade do consentimento HISTORY (BR-CLN-19). */
export const HISTORY_CONSENT_MONTHS = 12

/** `XXXX-XXXX` para mostrar. */
export const formatLinkCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`
