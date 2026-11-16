// Leitura do recibo emitido por marcação (BR-CLN-31): API pública para `appointments`/`examinations`/`clinic-patients`.
import type { ClinicReceipt } from "../domain/receipt.js";
import type { ClinicReceiptsDeps } from "./ports.js";

/** `ClinicBooking.receiptId` / `ClinicExamBooking.receiptId`: recibo `ISSUED` de cada marcação (nunca para o Médico). */
export function createFindIssuedReceiptIdsUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function findIssuedReceiptIds(trx: Trx, clinicId: string, kind: ClinicReceipt["bookingKind"], bookingIds: string[]): Promise<Map<string, string>> {
    return bookingIds.length === 0 ? new Map() : deps.receiptsRepo.findIssuedIdsByBookings(trx, clinicId, kind, bookingIds);
  };
}
