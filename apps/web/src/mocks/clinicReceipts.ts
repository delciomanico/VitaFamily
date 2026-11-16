import type { FamilyClinicReceipt, ReceiptBookingKind } from '@/types/clinicReceipt'
import { db, type MockClinicReceipt } from './db'

/*
 * Regras partilhadas dos recibos (M14 R, BR-CLN-31..36), usadas pelo portal da clínica e pela app
 * de família.
 */

/** Recibo `ISSUED` da marcação, se existir (no máximo um, BR-CLN-31). */
export function issuedReceiptOf(kind: ReceiptBookingKind, bookingId: string): MockClinicReceipt | undefined {
  return db.clinicReceipts.find((r) => r.bookingKind === kind && r.bookingId === bookingId && r.status === 'ISSUED')
}

/** Cópia do paciente (BR-CLN-35): sem motivo da anulação, sem ids da clínica nem da conta. */
export function toFamilyReceipt(receipt: MockClinicReceipt): FamilyClinicReceipt {
  return {
    id: receipt.id,
    number: receipt.number,
    clinicName: receipt.issuer.name,
    clinicAddress: receipt.issuer.address,
    clinicPhone: receipt.issuer.phone,
    status: receipt.status,
    paymentMethod: receipt.paymentMethod,
    currency: receipt.currency,
    totalMinor: receipt.totalMinor,
    patientName: receipt.patientName,
    note: receipt.note,
    lines: receipt.lines.map(({ description, amountMinor }) => ({ description, amountMinor })),
    issuedAt: receipt.issuedAt,
    voidedAt: receipt.voidedAt,
    notice: receipt.notice,
  }
}
