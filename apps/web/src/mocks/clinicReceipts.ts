import type { ClaimReceiptRef, InsuranceClaimReceipt } from '@/types/insurance'
import type { FamilyClinicReceipt, ReceiptBookingKind } from '@/types/clinicReceipt'
import { db, type MockClinicReceipt } from './db'

/*
 * Regras partilhadas dos recibos (M14 R, BR-CLN-31..36), usadas pelo portal da clínica, pela app
 * de família e pelo portal da seguradora.
 */

/** Recibo `ISSUED` da marcação, se existir (no máximo um, BR-CLN-31). */
export function issuedReceiptOf(kind: ReceiptBookingKind, bookingId: string): MockClinicReceipt | undefined {
  return db.clinicReceipts.find((r) => r.bookingKind === kind && r.bookingId === bookingId && r.status === 'ISSUED')
}

/** Pedidos de reembolso ativos (ainda não recusados) a que o recibo está anexado (BR-CLN-36). */
export function activeClaimsOfReceipt(receiptId: string) {
  return db.reimbursementClaims.filter((c) => c.status !== 'REJECTED' && c.receiptIds?.includes(receiptId))
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
    attachedToClaimIds: activeClaimsOfReceipt(receipt.id).map((c) => c.id),
  }
}

/** Referências dos recibos anexados, para o titular. */
export function claimReceiptRefs(receiptIds: string[] | undefined): ClaimReceiptRef[] {
  return (receiptIds ?? [])
    .map((id) => db.clinicReceipts.find((r) => r.id === id))
    .filter((r): r is MockClinicReceipt => r !== undefined)
    .map((r) => ({ receiptId: r.id, number: r.number, status: r.status, totalMinor: r.totalMinor, currency: r.currency }))
}

/** O que a seguradora vê (BR-CLN-36): clínica, número, data, linhas, total e estado — nada mais. */
export function insuranceReceiptSummaries(receiptIds: string[] | undefined): InsuranceClaimReceipt[] {
  return (receiptIds ?? [])
    .map((id) => db.clinicReceipts.find((r) => r.id === id))
    .filter((r): r is MockClinicReceipt => r !== undefined)
    .map((r) => ({
      number: r.number,
      issuedAt: r.issuedAt,
      clinicName: r.issuer.name,
      lines: r.lines.map(({ description, amountMinor }) => ({ description, amountMinor })),
      totalMinor: r.totalMinor,
      currency: r.currency,
      status: r.status,
    }))
}
