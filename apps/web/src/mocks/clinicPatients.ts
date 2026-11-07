import type { ClinicPatient, ConsentLevel } from '@/types/clinic'
import { HISTORY_CONSENT_MONTHS } from '@/types/clinicConsent'
import { addMonths, type MockClinicPatient } from './data/clinicPatients'
import { db, newId } from './db'

/*
 * Regras partilhadas de pacientes da clínica e consentimento (BR-CLN-17..21), usadas pelo
 * portal da clínica e pela app de família.
 */

export interface EffectiveConsent {
  level: ConsentLevel
  validUntil: string | null
  /** HISTORY expirado: aparece como BOOKINGS e pode renovar-se (BR-CLN-19). */
  renewalNeeded: boolean
}

/** Consentimento efetivo do membro para a clínica; um HISTORY expirado cai para BOOKINGS. */
export function effectiveConsent(memberId: string, clinicId: string, now: Date = new Date()): EffectiveConsent | undefined {
  const consent = db.clinicConsents.find((c) => c.memberId === memberId && c.clinicId === clinicId)
  if (!consent) return undefined
  if (consent.level === 'HISTORY' && consent.validUntil) {
    if (Date.parse(consent.validUntil) > now.getTime()) {
      return { level: 'HISTORY', validUntil: consent.validUntil, renewalNeeded: false }
    }
    return { level: 'BOOKINGS', validUntil: null, renewalNeeded: true }
  }
  return { level: 'BOOKINGS', validUntil: null, renewalNeeded: false }
}

/** `ClinicPatient` público: nunca ids Vita; `vitaLink` derivado do consentimento atual. */
export function toPublicPatient(patient: MockClinicPatient, now: Date = new Date()): ClinicPatient {
  const consent = patient.memberId ? effectiveConsent(patient.memberId, patient.clinicId, now) : undefined
  return {
    id: patient.id,
    name: patient.name,
    phone: patient.phone,
    email: patient.email,
    birthDate: patient.birthDate,
    notes: patient.notes,
    origin: patient.origin,
    vitaLink: patient.memberId
      ? {
          via: patient.linkVia ?? 'EMAIL',
          consentLevel: consent?.level ?? null,
          consentValidUntil: consent?.validUntil ?? null,
        }
      : null,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
  }
}

/** Paciente da clínica ligado ao membro, se existir. */
export function patientOfMember(clinicId: string, memberId: string): MockClinicPatient | undefined {
  return db.clinicPatients.find((p) => p.clinicId === clinicId && p.memberId === memberId)
}

/** Cria o consentimento BOOKINGS se não existir; nunca baixa um HISTORY (BR-CLN-19). */
export function ensureBookingsConsent(memberId: string, clinicId: string) {
  if (!db.clinicConsents.some((c) => c.memberId === memberId && c.clinicId === clinicId)) {
    db.clinicConsents.push({ memberId, clinicId, level: 'BOOKINGS' })
  }
}

/** Cria ou reutiliza o paciente da clínica ligado ao membro (ligação por e-mail/código). */
export function linkMember(
  clinicId: string,
  memberId: string,
  displayName: string,
  via: 'EMAIL' | 'CODE',
  now: Date = new Date(),
): MockClinicPatient {
  const existing = patientOfMember(clinicId, memberId)
  ensureBookingsConsent(memberId, clinicId)
  if (existing) return existing
  const stamp = now.toISOString()
  const patient: MockClinicPatient = {
    id: newId('cpt'),
    clinicId,
    name: displayName,
    phone: null,
    email: null,
    birthDate: null,
    notes: null,
    origin: 'VITA',
    vitaLink: null,
    memberId,
    linkVia: via,
    createdAt: stamp,
    updatedAt: stamp,
  }
  db.clinicPatients.push(patient)
  return patient
}

export const historyValidUntil = (now: Date = new Date()) => addMonths(now.toISOString(), HISTORY_CONSENT_MONTHS)
