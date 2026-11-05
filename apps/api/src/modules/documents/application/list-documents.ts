// openapi.yaml `listDocuments`: "Autorização: READ(categoria do recurso)". "Listar documentos de UM
// recurso" (endpoints.md) — `resourceType`/`resourceId` são opcionais na forma do contrato, mas a
// autorização por categoria exige conhecer o recurso; sem eles não há categoria a verificar.
import type { Document, ResourceType } from "../domain/document.js";
import { ValidationError } from "../../../platform/errors/index.js";
import type { ActorIdentity, DocumentsDeps } from "./ports.js";
import { accessInputFor, isVisibleToPatient } from "./support.js";

export interface ListDocumentsQuery {
  resourceType?: ResourceType;
  resourceId?: string;
}

export function createListDocumentsUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function listDocuments(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    query: ListDocumentsQuery,
  ): Promise<Document[]> {
    const { resourceType, resourceId } = query;
    if (!resourceType || !resourceId) {
      throw new ValidationError(
        [
          { field: "resourceType", message: "obrigatório" },
          { field: "resourceId", message: "obrigatório" },
        ],
        { detail: "Indique o recurso (resourceType e resourceId) para listar os seus documentos." },
      );
    }

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        subjectMemberId: memberId,
        ...accessInputFor(resourceType, "READ"),
      });

      const documents = await deps.documentsRepo.listByResource(trx, familyId, memberId, resourceType, resourceId);
      // BR-CLN-08: omite (não nega) os PDF da clínica ainda não libertados.
      const visible: Document[] = [];
      for (const document of documents) {
        if (await isVisibleToPatient(deps, trx, document)) {
          visible.push(document);
        }
      }
      return visible;
    });
  };
}
