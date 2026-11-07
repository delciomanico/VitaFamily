import { AppError } from '@/lib/errors'
import type { ConsentLevel } from '@/types/clinic'
import {
  LINK_CODE_ALPHABET,
  LINK_CODE_TTL_MS,
  type ClinicConsent,
  type ClinicLinkCode,
} from '@/types/clinicConsent'
import { memberAccess } from '../access'
import { effectiveConsent, historyValidUntil, patientOfMember } from '../clinicPatients'
import { db } from '../db'
import { respond } from '../respond'

/*
 * Lado família do consentimento por clínica e do código de ligação (M14 P, BR-CLN-19/20,
 * authorization.md §6.4): só o titular adulto (SELF) ou o tutor; o dependente com conta e os
 * outros membros nunca.
 */

/** Titular adulto ou tutor; DEPENDENT_SELF e OTHER → FORBIDDEN; fora da família → NOT_FOUND. */
function requireConsenter(familyId: string, userId: string, memberId: string) {
  const access = memberAccess(familyId, userId, memberId)
  const member = db.members.find((m) => m.id === memberId)
  if (!access.manage || !member || (member.userId === userId && member.isDependent)) throw new AppError('FORBIDDEN')
  return member
}

const partnerClinic = (clinicId: string) =>
  db.clinics.find((c) => c.id === clinicId && c.type === 'PARTNER' && c.status === 'ACTIVE')

function toConsent(memberId: string, clinicId: string, now: Date): ClinicConsent {
  const clinic = db.clinics.find((c) => c.id === clinicId)
  const consent = effectiveConsent(memberId, clinicId, now)
  return {
    clinicId,
    clinicName: clinic?.name ?? '',
    level: consent?.level ?? 'BOOKINGS',
    validUntil: consent?.validUntil ?? null,
    renewalNeeded: consent?.renewalNeeded ?? false,
    linked: patientOfMember(clinicId, memberId) !== undefined,
  }
}

/** `GET …/clinic-consents`: clínicas parceiras com consentimento e/ou ligação ao membro. */
export function listClinicConsents(familyId: string, userId: string, memberId: string, now: Date = new Date()) {
  return respond((): ClinicConsent[] => {
    requireConsenter(familyId, userId, memberId)
    const ids = new Set([
      ...db.clinicConsents.filter((c) => c.memberId === memberId).map((c) => c.clinicId),
      ...db.clinicPatients.filter((p) => p.memberId === memberId).map((p) => p.clinicId),
    ])
    return [...ids]
      .filter((id) => partnerClinic(id))
      .map((id) => toConsent(memberId, id, now))
      .sort((a, b) => a.clinicName.localeCompare(b.clinicName, 'pt-PT'))
  })
}

/** `PUT …/clinic-consents/{clinicId}`: conceder, alterar ou renovar (HISTORY vale 12 meses). */
export function putClinicConsent(
  familyId: string,
  userId: string,
  memberId: string,
  clinicId: string,
  level: ConsentLevel,
  now: Date = new Date(),
) {
  return respond((): ClinicConsent => {
    requireConsenter(familyId, userId, memberId)
    if (!partnerClinic(clinicId)) throw new AppError('NOT_FOUND')
    if (level !== 'BOOKINGS' && level !== 'HISTORY') throw new AppError('VALIDATION_ERROR')
    const validUntil = level === 'HISTORY' ? historyValidUntil(now) : undefined
    const existing = db.clinicConsents.find((c) => c.memberId === memberId && c.clinicId === clinicId)
    if (existing) {
      existing.level = level
      existing.validUntil = validUntil
    } else {
      db.clinicConsents.push({ memberId, clinicId, level, validUntil })
    }
    return toConsent(memberId, clinicId, now)
  })
}

/** `DELETE …/clinic-consents/{clinicId}`: apaga consentimento e ligação; a clínica conserva o que criou. */
export function revokeClinicConsent(familyId: string, userId: string, memberId: string, clinicId: string) {
  return respond((): void => {
    requireConsenter(familyId, userId, memberId)
    const linked = db.clinicPatients.filter((p) => p.memberId === memberId && p.clinicId === clinicId)
    const had = db.clinicConsents.some((c) => c.memberId === memberId && c.clinicId === clinicId)
    if (!had && linked.length === 0) throw new AppError('NOT_FOUND')
    db.clinicConsents = db.clinicConsents.filter((c) => !(c.memberId === memberId && c.clinicId === clinicId))
    for (const patient of linked) {
      patient.memberId = undefined
      patient.linkVia = undefined
    }
  })
}

const CODES_PER_HOUR = 5

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return [...bytes].map((b) => LINK_CODE_ALPHABET[b % LINK_CODE_ALPHABET.length]).join('')
}

/** `POST …/clinic-link-codes`: 8 caracteres, uso único, 10 min; invalida o anterior; 5/hora. */
export function createClinicLinkCode(familyId: string, userId: string, memberId: string, now: Date = new Date()) {
  return respond((): ClinicLinkCode => {
    requireConsenter(familyId, userId, memberId)
    const hourAgo = now.getTime() - 3_600_000
    const recent = db.clinicLinkCodes.filter((c) => c.memberId === memberId && Date.parse(c.createdAt) > hourAgo)
    if (recent.length >= CODES_PER_HOUR) throw new AppError('RATE_LIMITED')
    for (const previous of db.clinicLinkCodes) if (previous.memberId === memberId) previous.used = true
    const code = randomCode()
    const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS).toISOString()
    db.clinicLinkCodes.push({ memberId, code, createdAt: now.toISOString(), expiresAt, used: false })
    return { code, expiresAt }
  })
}
