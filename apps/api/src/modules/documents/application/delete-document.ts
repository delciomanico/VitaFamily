// openapi.yaml `deleteDocument`: "Autorização: WRITE(categoria do recurso). Apaga ficheiro via
// outbox." AC-DOC-05, BR-DOC-05, ADR-011: enfileira `file_deletions` ANTES de apagar a linha, na
// mesma transação (schema.md §7, mesmo padrão de `users`/`families`).
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, DocumentsDeps, RequestContext } from "./ports.js";
import { categoryForResourceType } from "./support.js";

export function createDeleteDocumentUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function deleteDocument(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    documentId: string,
    context: RequestContext,
  ): Promise<void> {
    return deps.withTransaction(async (trx) => {
      const document = await deps.documentsRepo.findById(trx, familyId, memberId, documentId);
      if (!document) {
        throw new NotFoundError({ detail: "Documento não encontrado." });
      }

      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "DELETE",
        subjectMemberId: memberId,
        category: categoryForResourceType(document.resourceType),
      });

      await deps.fileDeletionsRepo.enqueue(trx, document.storageKey);
      await deps.documentsRepo.delete(trx, familyId, memberId, documentId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "DOCUMENT_DELETE",
        resourceType: "Document",
        resourceId: documentId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
