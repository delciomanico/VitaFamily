// Emitir recibo (UC-CLN-25, BR-CLN-31/32/34/35): "um toque" a partir de uma marcação `COMPLETED` da própria clínica.
// Numeração sequencial por clínica atribuída na MESMA transação (sem buracos). O retrato (nome, cabeçalho, moeda) é imutável.
// Auditoria `CLINIC_RECEIPT_ISSUE` sem nomes, descrições nem valores.
import { ConflictError, DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { buildReceiptLines, MAX_PATIENT_NAME, type CatalogService, type RequestedLine } from "../domain/receipt.js";
import { parseIssueReceiptInput } from "../domain/receipt-input.js";
import type { ClinicPortalActor, ClinicReceiptsDeps, RequestContext } from "./ports.js";
import { assertCanManageReceipts, toReceiptView, type ClinicReceiptView } from "./support.js";

export function createIssueReceiptUseCase<Trx>(deps: ClinicReceiptsDeps<Trx>) {
  return async function issueReceipt(actor: ClinicPortalActor, body: unknown, context: RequestContext): Promise<ClinicReceiptView> {
    assertCanManageReceipts(actor);
    const input = parseIssueReceiptInput(body);

    return deps.withTransaction(async (trx) => {
      const booking = await deps.bookings.find(trx, actor.clinicId, input.bookingKind, input.bookingId);
      if (!booking) {
        throw new NotFoundError({ detail: "Marcação não encontrada." });
      }
      if (booking.status !== "COMPLETED") {
        throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Só se emite recibo de marcações concluídas." });
      }
      if (await deps.receiptsRepo.findIssuedByBooking(trx, actor.clinicId, input.bookingKind, input.bookingId)) {
        throw new ConflictError({ detail: "Já existe um recibo emitido para esta marcação." });
      }

      // Linhas omitidas => uma linha com o serviço do horário (BR-CLN-31); sem serviço => VALIDATION_ERROR.
      let requested: RequestedLine[];
      if (input.lines) {
        requested = input.lines;
      } else if (booking.serviceTypeId) {
        requested = [{ serviceTypeId: booking.serviceTypeId }];
      } else {
        throw new ValidationError([{ field: "lines", message: "a marcação não tem serviço do catálogo; indique as linhas" }], { detail: "Linhas em falta." });
      }
      const services = new Map<string, CatalogService>();
      for (const id of new Set(requested.flatMap((l) => (l.serviceTypeId ? [l.serviceTypeId] : [])))) {
        const service = await deps.services.find(trx, actor.clinicId, id);
        if (!service) {
          throw new NotFoundError({ detail: "Serviço não encontrado." });
        }
        services.set(id, service);
      }
      const { lines, totalMinor } = buildReceiptLines(requested, services);

      const profile = await deps.profile.get(trx, actor.clinicId);
      const now = deps.clock.now();
      // BR-CLN-32: o contador da clínica serializa emissões concorrentes e reverte se a transação falhar.
      const number = await deps.receiptsRepo.nextNumber(trx, actor.clinicId);
      const receipt = await deps.receiptsRepo.insert(
        trx,
        {
          id: newId(),
          clinicId: actor.clinicId,
          bookingKind: input.bookingKind,
          bookingId: input.bookingId,
          paymentMethod: input.paymentMethod,
          currency: profile.currency,
          totalMinor,
          patientName: booking.patientName.slice(0, MAX_PATIENT_NAME),
          note: input.note ?? null,
          issuer: profile.issuer,
          lines,
          issuedAt: now,
          issuedByClinicAccountId: actor.clinicAccountId,
        },
        number,
      );

      // BR-CLN-35: ligação ao paciente só para marcações Vita com consentimento (qualquer nível) NA EMISSÃO; nunca retroativa.
      let linked = false;
      if (booking.vita && (await deps.consents.hasConsent(trx, actor.clinicId, booking.vita.memberId))) {
        await deps.receiptsRepo.insertLink(trx, receipt.id, booking.vita.familyId, booking.vita.memberId, now);
        linked = true;
      }

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        actorClinicId: actor.clinicId,
        action: "CLINIC_RECEIPT_ISSUE",
        resourceType: "ClinicReceipt",
        resourceId: receipt.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { bookingKind: input.bookingKind, paymentMethod: input.paymentMethod, lineCount: lines.length, linkedToPatient: linked },
      });
      return toReceiptView(receipt, linked);
    });
  };
}
