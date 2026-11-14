// openapi removeAuthorizationAttachment (BR-AUT-13): só em pedido pendente e só anexos carregados pela clínica; o ficheiro apaga-se
// pelo outbox `file_deletions` (mesma transação).
import { DomainError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ClinicOpsActor } from "../domain/access.js";
import { isPending } from "../domain/authorization-machine.js";
import { loadForWrite } from "./authorization-support.js";
import { notFoundError } from "./beneficiary-lookup.js";
import type { OpsDeps, RequestContext } from "./ports.js";

export function createRemoveAuthorizationAttachmentUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function removeAuthorizationAttachment(actor: ClinicOpsActor, authorizationId: string, attachmentId: string, context: RequestContext): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const { row } = await loadForWrite(deps, trx, actor, authorizationId);
      const attachment = await deps.authorizations.findAttachment(trx, row.insurerId, row.id, attachmentId);
      if (!attachment) throw notFoundError();
      if (!isPending(row.status) || attachment.uploadedByClinicAccountId === null) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Este anexo já não pode ser removido." });
      const now = deps.clock.now();
      await deps.authorizations.deleteAttachment(trx, row.insurerId, attachment.id);
      await deps.files.scheduleDelete(trx, attachment.storageKey);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        actorClinicId: actor.clinicId,
        action: "AUTHORIZATION_ATTACHMENT_REMOVE",
        resourceType: "AuthorizationRequest",
        resourceId: row.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { insurerId: row.insurerId, kind: attachment.kind, sizeBytes: attachment.sizeBytes },
      });
    });
  };
}
