// openapi addAuthorizationAttachment (BR-AUT-13): anexo ADMINISTRATIVO (lista fechada de tipos), PDF/JPG/PNG verificados pelo conteúdo,
// ≤ 10 MB, máx. 5 por pedido, só em pedido pendente. Antivírus SÍNCRONO antes de gravar (infetado ⇒ 422 e nada gravado; indisponível
// ⇒ 503). O prestador só vê metadados e a família nunca. O nome do ficheiro nunca vai à auditoria nem aos logs.
import { createHash } from "node:crypto";
import { DomainError, ServiceUnavailableError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertClinicRole, type ClinicOpsActor } from "../domain/access.js";
import { attachmentStorageKey, ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_REQUEST, detectAttachmentMime } from "../domain/attachment-file.js";
import { parseAttachmentKind, type AuthorizationAttachment } from "../domain/authorization.js";
import { isPending } from "../domain/authorization-machine.js";
import { requireText } from "../domain/validation.js";
import { loadForWrite } from "./authorization-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";

export interface UploadedAttachment {
  buffer: Buffer;
  originalName: string;
}

export function createAddAuthorizationAttachmentUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function addAuthorizationAttachment(actor: ClinicOpsActor, authorizationId: string, input: { kind: unknown; file: UploadedAttachment }, context: RequestContext): Promise<AuthorizationAttachment> {
    assertClinicRole(actor.role);
    const kind = parseAttachmentKind(input.kind);
    const originalName = requireText(input.file.originalName, "file", 255);
    if (input.file.buffer.length > ATTACHMENT_MAX_BYTES) throw new DomainError("FILE_TOO_LARGE", { detail: "Ficheiro acima do limite permitido (10 MB)." });
    const mime = detectAttachmentMime(input.file.buffer);
    if (mime === null) throw new DomainError("FILE_TYPE_NOT_ALLOWED", { detail: "Tipo de ficheiro não permitido (só PDF, JPG, PNG)." });

    return deps.withTransaction(async (trx) => {
      const { row } = await loadForWrite(deps, trx, actor, authorizationId);
      if (!isPending(row.status)) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "O pedido já não aceita anexos." });
      if ((await deps.authorizations.countAttachments(trx, row.insurerId, row.id)) >= ATTACHMENTS_PER_REQUEST) {
        throw new DomainError("DOCUMENT_LIMIT_EXCEEDED", { detail: "Máximo de 5 anexos por pedido." });
      }
      let verdict: "CLEAN" | "INFECTED";
      try {
        verdict = await deps.files.scan(input.file.buffer);
      } catch (error) {
        throw new ServiceUnavailableError({ detail: "Não foi possível verificar o ficheiro. Tente mais tarde.", cause: error });
      }
      if (verdict === "INFECTED") throw new ValidationError([{ field: "file", message: "ficheiro rejeitado pela verificação de segurança" }], { detail: "Ficheiro rejeitado." });

      const now = deps.clock.now();
      const id = newId();
      const storageKey = attachmentStorageKey(row.insurerId, id, mime);
      const attachment = await deps.authorizations.insertAttachment(trx, {
        id,
        insurerId: row.insurerId,
        authorizationId: row.id,
        kind,
        storageKey,
        originalName,
        mimeType: mime,
        sizeBytes: input.file.buffer.length,
        checksumSha256: createHash("sha256").update(input.file.buffer).digest("hex"),
        uploadedByClinicAccountId: actor.clinicAccountId,
        createdAt: now,
      });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        actorClinicId: actor.clinicId,
        action: "AUTHORIZATION_ATTACHMENT_ADD",
        resourceType: "AuthorizationRequest",
        resourceId: row.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { insurerId: row.insurerId, kind, sizeBytes: attachment.sizeBytes },
      });
      // Por último: se a escrita no `Storage` falhar, a transação reverte e nada fica gravado.
      await deps.files.put(storageKey, input.file.buffer, mime);
      return attachment;
    });
  };
}
