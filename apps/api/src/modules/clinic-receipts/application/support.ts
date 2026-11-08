import { ForbiddenError } from "../../../platform/errors/index.js";
import type { ClinicReceipt } from "../domain/receipt.js";
import { RECEIPT_NOTICE } from "../domain/receipt.js";
import type { ClinicPortalActor } from "./ports.js";

/** BR-CLN-39: recibos e Financeiro só para Admin e Gestor; o Médico => `FORBIDDEN` (a matriz do portal já o recusa; defesa em profundidade). */
export function assertCanManageReceipts(actor: ClinicPortalActor): void {
  if (actor.role === "CLINIC_DOCTOR") {
    throw new ForbiddenError({ detail: "Sem permissão para recibos." });
  }
}

/** `components.schemas.ClinicReceipt` (portal): contém tudo o que é preciso para imprimir; sem ids Vita. */
export interface ClinicReceiptView {
  id: string;
  number: number;
  bookingKind: ClinicReceipt["bookingKind"];
  bookingId: string;
  status: ClinicReceipt["status"];
  paymentMethod: ClinicReceipt["paymentMethod"];
  currency: string;
  totalMinor: number;
  patientName: string;
  note: string | null;
  issuer: ClinicReceipt["issuer"];
  lines: { position: number; description: string; amountMinor: number; serviceTypeId: string | null }[];
  issuedAt: string;
  issuedByClinicAccountId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByClinicAccountId: string | null;
  notice: string;
  availableToPatient: boolean;
}

export function toReceiptView(receipt: ClinicReceipt, availableToPatient: boolean): ClinicReceiptView {
  return {
    id: receipt.id,
    number: receipt.number,
    bookingKind: receipt.bookingKind,
    bookingId: receipt.bookingId,
    status: receipt.status,
    paymentMethod: receipt.paymentMethod,
    currency: receipt.currency,
    totalMinor: receipt.totalMinor,
    patientName: receipt.patientName,
    note: receipt.note,
    issuer: receipt.issuer,
    lines: receipt.lines.map((l) => ({ position: l.position, description: l.description, amountMinor: l.amountMinor, serviceTypeId: l.serviceTypeId })),
    issuedAt: receipt.issuedAt.toISOString(),
    issuedByClinicAccountId: receipt.issuedByClinicAccountId,
    voidedAt: receipt.voidedAt?.toISOString() ?? null,
    voidReason: receipt.voidReason,
    voidedByClinicAccountId: receipt.voidedByClinicAccountId,
    notice: RECEIPT_NOTICE,
    availableToPatient,
  };
}
