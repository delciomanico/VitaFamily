// Adaptador da porta `ClinicReceiptLookup` de `insurance` (modules.md §2 nota 26): `insurance` define a porta na sua
// `application`; este adaptador (camada `interface` de `clinic-receipts`) devolve formas estruturalmente compatíveis, SEM
// importar `insurance`, e é ligado em `main/api.ts`. Resumo mínimo (BR-CLN-36): sem motivo, método, profissional nem ids.
import type { ReceiptInsurerSummary, ReceiptRef } from "../application/claim-lookup.js";

export interface ClinicReceiptLookupAdapter<Trx> {
  lockVisibleReceipts(trx: Trx, familyId: string, memberId: string, receiptIds: string[]): Promise<ReceiptRef[]>;
  receiptRefs(trx: Trx, receiptIds: string[]): Promise<ReceiptRef[]>;
  receiptInsurerSummaries(trx: Trx, receiptIds: string[]): Promise<ReceiptInsurerSummary[]>;
}

export interface ClaimReceiptRefDto {
  receiptId: string;
  number: number;
  status: "ISSUED" | "VOIDED";
  totalMinor: number;
  currency: string;
}

export interface InsuranceClaimReceiptDto {
  number: number;
  issuedAt: string;
  clinicName: string;
  lines: { description: string; amountMinor: number }[];
  totalMinor: number;
  currency: string;
  status: "ISSUED" | "VOIDED";
}

export interface ReceiptForClaim {
  id: string;
  number: number;
  status: "ISSUED" | "VOIDED";
  totalMinor: number;
  currency: string;
}

export function createClinicReceiptLookup<Trx>(source: ClinicReceiptLookupAdapter<Trx>) {
  return {
    lockVisible: (trx: Trx, familyId: string, memberId: string, receiptIds: string[]): Promise<ReceiptForClaim[]> => source.lockVisibleReceipts(trx, familyId, memberId, receiptIds),
    refs: async (trx: Trx, receiptIds: string[]): Promise<ClaimReceiptRefDto[]> =>
      (await source.receiptRefs(trx, receiptIds)).map((r) => ({ receiptId: r.id, number: r.number, status: r.status, totalMinor: r.totalMinor, currency: r.currency })),
    summaries: async (trx: Trx, receiptIds: string[]): Promise<(InsuranceClaimReceiptDto & { id: string })[]> =>
      (await source.receiptInsurerSummaries(trx, receiptIds)).map((r) => ({
        id: r.id,
        number: r.number,
        issuedAt: r.issuedAt.toISOString(),
        clinicName: r.clinicName,
        lines: r.lines,
        totalMinor: r.totalMinor,
        currency: r.currency,
        status: r.status,
      })),
  };
}
