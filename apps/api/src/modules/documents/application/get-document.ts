// openapi.yaml `getDocument`: "Autorização: READ(categoria do recurso)". A categoria só se conhece
// depois de encontrar o documento (o seu `resourceType`) — por isso a busca (scoped por
// família+membro, nunca global, conventions.md §3.4) acontece antes da política; errors.md regra 2
// continua a valer: se o documento não existe NESTA família/membro, `NotFoundError` (404) — nunca
// se chega a saber a categoria para distinguir de um 403.
import { NotFoundError } from "../../../platform/errors/index.js";
import type { Document } from "../domain/document.js";
import type { ActorIdentity, DocumentsDeps } from "./ports.js";
import { accessInputFor, isVisibleToPatient } from "./support.js";

export function createGetDocumentUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function getDocument(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    documentId: string,
  ): Promise<Document> {
    return deps.withTransaction(async (trx) => {
      const document = await deps.documentsRepo.findById(trx, familyId, memberId, documentId);
      if (!document) {
        throw new NotFoundError({ detail: "Documento não encontrado." });
      }

      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        subjectMemberId: memberId,
        ...accessInputFor(document.resourceType, "READ"),
      });

      // BR-CLN-08: PDF da clínica ainda não libertado -> como se não existisse.
      if (!(await isVisibleToPatient(deps, trx, document))) {
        throw new NotFoundError({ detail: "Documento não encontrado." });
      }

      return document;
    });
  };
}
