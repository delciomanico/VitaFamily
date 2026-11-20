import { AppError } from '@/lib/errors'
import type { ProfessionalPrescription, ProfessionalPrescriptionInput } from '@/types/recordSharing'
import { consultationsDb, type MockBooking } from '../consultationsDb'
import { db } from '../db'
import { recordSharingDb, recordSharingFlags } from '../recordSharingDb'
import { respond } from '../respond'
import { insertProfessionalPrescription } from './medications'
import { requireProfessional } from './professionalPortal'

/*
 * Receita digital do profissional (MK4: `POST /professional-portal/bookings/{id}/prescriptions` e
 * `GET …/prescription`), atrás de `DIGITAL_PRESCRIPTION_ENABLED` (BR-MKT-79). Com a flag desligada as duas
 * rotas dão `404`, indistinguível de rota inexistente. O profissional só relê o que escreveu e nunca ganha
 * acesso ao resto do registo.
 */

const DAY = 86_400_000
/** Emissão até 7 dias depois de a consulta ser concluída, em qualquer método (OP-126). */
const ISSUE_WINDOW_MS = 7 * DAY

const prescriptionOf = (bookingId: string) => recordSharingDb.prescriptions.find((p) => p.bookingId === bookingId)

/** A receita ainda existe no registo (a família pode tê-la apagado, BR-RX-06). */
const stillExists = (bookingId: string) => {
  const record = prescriptionOf(bookingId)
  return record !== undefined && db.prescriptions.some((p) => p.id === record.prescriptionId)
}

/** Derivado (BR-MKT-80): sempre `false` com a flag desligada. */
export function canPrescribe(booking: MockBooking, approved: boolean, now = Date.now()): boolean {
  return (
    recordSharingFlags.digitalPrescription &&
    approved &&
    booking.status === 'COMPLETED' &&
    booking.offer.category === 'HEALTH' &&
    booking.completedAt !== undefined &&
    now <= Date.parse(booking.completedAt) + ISSUE_WINDOW_MS &&
    prescriptionOf(booking.id) === undefined
  )
}

/** Campos aditivos de `ProfessionalBooking` (omitidos com a flag desligada). */
export function prescriptionFlagsOf(booking: MockBooking, approved: boolean): { canPrescribe?: boolean; hasPrescription?: boolean } {
  if (!recordSharingFlags.digitalPrescription) return {}
  return { canPrescribe: canPrescribe(booking, approved), hasPrescription: prescriptionOf(booking.id) !== undefined }
}

/** `FamilyBooking.prescriptionId`: só existe com a receita digital ligada e enquanto a receita existir. */
export function prescriptionIdOf(bookingId: string): string | undefined {
  if (!recordSharingFlags.digitalPrescription || !stillExists(bookingId)) return undefined
  return prescriptionOf(bookingId)?.prescriptionId
}

function requireEnabled() {
  if (!recordSharingFlags.digitalPrescription) throw new AppError('NOT_FOUND')
}

function ownBooking(professionalId: string, bookingId: string): MockBooking {
  const booking = consultationsDb.bookings.find((b) => b.id === bookingId && b.professionalId === professionalId)
  if (!booking) throw new AppError('NOT_FOUND')
  return booking
}

function toPrescription(bookingId: string): ProfessionalPrescription {
  const record = prescriptionOf(bookingId)
  if (!record || !stillExists(bookingId)) throw new AppError('NOT_FOUND')
  return { bookingId, issuedOn: record.issuedOn, notes: record.notes, medications: record.medications, createdAt: record.createdAt }
}

export function issueProfessionalPrescription(bookingId: string, input: ProfessionalPrescriptionInput): Promise<ProfessionalPrescription> {
  return respond(() => {
    requireEnabled()
    const record = requireProfessional()
    const booking = ownBooking(record.id, bookingId)
    if (record.validationStatus !== 'APPROVED') throw new AppError('PROFESSIONAL_LOCKED')
    if (booking.offer.category !== 'HEALTH') throw new AppError('FORBIDDEN')
    const now = new Date()
    if (booking.status !== 'COMPLETED' || !booking.completedAt || now.getTime() > Date.parse(booking.completedAt) + ISSUE_WINDOW_MS) throw new AppError('INVALID_STATE_TRANSITION')
    if (prescriptionOf(booking.id) && stillExists(booking.id)) throw new AppError('CONFLICT')
    const created = insertProfessionalPrescription({ familyId: booking.familyId, memberId: booking.memberId, bookingId: booking.id, doctorName: record.displayName ?? 'Profissional' }, input, now)
    recordSharingDb.prescriptions = recordSharingDb.prescriptions.filter((p) => p.bookingId !== booking.id)
    recordSharingDb.prescriptions.push({
      bookingId: booking.id,
      professionalId: record.id,
      prescriptionId: created.id,
      issuedOn: created.issuedOn,
      notes: created.notes,
      medications: structuredClone(input.medications),
      createdAt: now.toISOString(),
    })
    return toPrescription(booking.id)
  })
}

export function getProfessionalBookingPrescription(bookingId: string): Promise<ProfessionalPrescription> {
  return respond(() => {
    requireEnabled()
    const record = requireProfessional()
    ownBooking(record.id, bookingId)
    return toPrescription(bookingId)
  })
}
