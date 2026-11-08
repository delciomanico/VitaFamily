// Anular recibo (UC-CLN-26, BR-CLN-33): `ISSUED -> VOIDED`, irreversível; o número mantém-se e nunca se reutiliza.
// O motivo é interno da clínica (nunca vai ao paciente nem à seguradora) e NÃO entra na auditoria.
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertCanVoid, parseVoidReason } from "../domain/receipt.js";
import type { ClinicPortalActor, ClinicReceiptsDeps, RequestContext } from "./ports.js";
import { assertCanManageReceipts, toReceiptView, type ClinicReceiptView } from "./support.js";

export function createVoidReceiptUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function voidReceipt(actor: ClinicPortalActor, receiptId: string, body: unknown, context: RequestContext): Promise<ClinicReceiptView> {
    assertCanManageReceipts(actor);
    const reason = parseVoidReason((body as { reason?: unknown } | null)?.reason);

    return deps.withTransaction(async (trx) => {
      // `FOR UPDATE`: duas anulações em simultâneo => a segunda vê `VOIDED` e recebe INVALID_STATE_TRANSITION.
      const existing = await deps.receiptsRepo.findById(trx, actor.clinicId, receiptId, true);
      if (!existing) {
        throw new NotFoundError({ detail: "Recibo não encontrado." });
      }
      assertCanVoid(existing.status);
      const now = deps.clock.now();
      const voided = await deps.receiptsRepo.markVoided(trx, actor.clinicId, receiptId, reason, actor.clinicAccountId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        actorClinicId: actor.clinicId,
        action: "CLINIC_RECEIPT_VOID",
        resourceType: "ClinicReceipt",
        resourceId: receiptId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      const available = await deps.receiptsRepo.availableToPatient(trx, [receiptId]);
      return toReceiptView(voided, available.has(receiptId));
    });
  };
}
