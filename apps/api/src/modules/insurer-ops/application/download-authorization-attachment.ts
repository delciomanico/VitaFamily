// openapi downloadInsurerAuthorizationAttachment (BR-AUT-13/19, ADR-006): autoriza, audita e entrega em stream. Só analista e
// supervisor descarregam (Admin/Claims/Finance veem só metadados). Anexo de outro pedido ou seguradora ⇒ 404. A auditoria não leva o
// nome do ficheiro. O ficheiro lê-se DEPOIS de a transação comitar (a auditoria fica gravada).
import type { Readable } from "node:stream";
import type { OpsActor } from "../domain/access.js";
import { requireUuid } from "../domain/validation.js";
import { notFoundError } from "./beneficiary-lookup.js";
import { actionActor, assertActionAllowed, loadForDecision, subjectOf } from "./insurer-authorization-support.js";
import { checkAction } from "../domain/authorization-actions.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize } from "./support.js";

export interface AttachmentDownload {
  stream: Readable;
  mimeType: string;
  originalName: string;
}

export function createDownloadAuthorizationAttachmentUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function downloadAuthorizationAttachment(actor: OpsActor, authorizationId: string, attachmentId: string, context: RequestContext): Promise<AttachmentDownload> {
    requireUuid(authorizationId, "authorizationId");
    requireUuid(attachmentId, "attachmentId");
    const attachment = await deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "authorizations-decide");
      const { row, appealDays, now } = await loadForDecision(deps, trx, actor, authorizationId);
      assertActionAllowed(checkAction("DOWNLOAD_ATTACHMENT", actionActor(actor), subjectOf(row, appealDays, now)));
      const found = await deps.authorizations.findAttachment(trx, actor.insurerId, row.id, attachmentId);
      if (!found) throw notFoundError();
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "AUTHORIZATION_ATTACHMENT_DOWNLOAD", resourceType: "AuthorizationRequest", resourceId: row.id, metadata: { kind: found.kind, sizeBytes: found.sizeBytes } }));
      return found;
    });
    return { stream: await deps.files.get(attachment.storageKey), mimeType: attachment.mimeType, originalName: attachment.originalName };
  };
}
