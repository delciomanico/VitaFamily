// openapi.yaml `downloadDocument`: "Autorização: READ(categoria do recurso). BR-DOC-04, ADR-006:
// autoriza, audita e entrega; Cache-Control: private, no-store; Content-Disposition: attachment."
// AC-DOC-01 (só CLEAN pode ser descarregado), AC-DOC-04 (negado sem permissão; auditado quando
// permitido). A autorização+auditoria acontecem numa transação curta; o stream do ficheiro só é
// pedido ao `Storage` depois de committed (não mantém a ligação à BD aberta durante o download).
import { DomainError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { Document } from "../domain/document.js";
import type { ActorIdentity, DocumentsDeps, DownloadStream, RequestContext } from "./ports.js";
import { accessInputFor, isVisibleToPatient } from "./support.js";

export interface DownloadDocumentResult {
  document: Document;
  stream: DownloadStream;
}

export function createDownloadDocumentUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function downloadDocument(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    documentId: string,
    context: RequestContext,
  ): Promise<DownloadDocumentResult> {
    const document = await deps.withTransaction(async (trx) => {
      const found = await deps.documentsRepo.findById(trx, familyId, memberId, documentId);
      if (!found) {
        throw new NotFoundError({ detail: "Documento não encontrado." });
      }

      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        subjectMemberId: memberId,
        ...accessInputFor(found.resourceType, "READ"),
      });

      // BR-CLN-08: PDF da clínica só é descarregável com o exame COMPLETED.
      if (!(await isVisibleToPatient(deps, trx, found))) {
        throw new NotFoundError({ detail: "Documento não encontrado." });
      }

      // AC-DOC-01: só depois de CLEAN pode ser descarregado (BR-DOC-02: positivo -> eliminado).
      if (found.scanStatus !== "CLEAN") {
        throw new DomainError("DOCUMENT_NOT_AVAILABLE", { detail: "Documento ainda em verificação antivírus." });
      }

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "DOCUMENT_DOWNLOAD",
        resourceType: "Document",
        resourceId: found.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return found;
    });

    const stream = await deps.storage.getObject(document.storageKey);
    return { document, stream };
  };
}
