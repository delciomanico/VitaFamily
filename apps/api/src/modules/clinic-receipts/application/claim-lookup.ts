// Leitura de recibos para os pedidos de reembolso (BR-CLN-36): consumida por `insurance` através da sua porta
// `ClinicReceiptLookup` (implementada em `interface/claim-lookup.ts` e ligada em `main/api.ts`); este módulo nunca importa
// `insurance`. A decisão de "não anexado a outro pedido ativo" é de `insurance` (dona de `reimbursement_claim_receipts`).
import type { ClinicReceipt } from "../domain/receipt.js";
import type { ClinicReceiptsDeps } from "./ports.js";

/** Resumo mínimo do recibo para o titular/seguradora: nada de motivo, método, profissional nem ids. */
export interface ReceiptRef {
  id: string;
  number: number;
  status: ClinicReceipt["status"];
  totalMinor: number;
  currency: string;
}

export interface ReceiptInsurerSummary {
  id: string;
  number: number;
  issuedAt: Date;
  clinicName: string;
  lines: { description: string; amountMinor: number }[];
  totalMinor: number;
  currency: string;
  status: ClinicReceipt["status"];
}

function toRef(r: ClinicReceipt): ReceiptRef {
  return { id: r.id, number: r.number, status: r.status, totalMinor: r.totalMinor, currency: r.currency };
}

/** Recibos visíveis ao membro (`clinic_receipt_links`), bloqueados para a anexação; ids não visíveis ficam de fora. */
export function createLockVisibleReceiptsUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function lockVisibleReceipts(trx: Trx, familyId: string, memberId: string, receiptIds: string[]): Promise<ReceiptRef[]> {
    return (await deps.receiptsRepo.lockLinkedByMember(trx, familyId, memberId, receiptIds)).map(toRef);
  };
}

export function createReceiptRefsUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function receiptRefs(trx: Trx, receiptIds: string[]): Promise<ReceiptRef[]> {
    return (await deps.receiptsRepo.findManyByIds(trx, receiptIds)).map(toRef);
  };
}

export function createReceiptInsurerSummariesUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function receiptInsurerSummaries(trx: Trx, receiptIds: string[]): Promise<ReceiptInsurerSummary[]> {
    return (await deps.receiptsRepo.findManyByIds(trx, receiptIds)).map((r) => ({
      id: r.id,
      number: r.number,
      issuedAt: r.issuedAt,
      clinicName: r.issuer.name,
      lines: r.lines.map((l) => ({ description: l.description, amountMinor: l.amountMinor })),
      totalMinor: r.totalMinor,
      currency: r.currency,
      status: r.status,
    }));
  };
}

/** `ClinicBooking.receiptId` / `ClinicExamBooking.receiptId`: recibo `ISSUED` de cada marcação (nunca para o Médico). */
export function createFindIssuedReceiptIdsUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function findIssuedReceiptIds(trx: Trx, clinicId: string, kind: ClinicReceipt["bookingKind"], bookingIds: string[]): Promise<Map<string, string>> {
    return bookingIds.length === 0 ? new Map() : deps.receiptsRepo.findIssuedIdsByBookings(trx, clinicId, kind, bookingIds);
  };
}
