// Worker `documents.scan` (modules.md §5): antivírus (BR-DOC-02, ADR-006). AC-DOC-01 (CLEAN só
// depois do scan), AC-DOC-02 (INFECTED -> ficheiro eliminado, upload recusado, auditado como
// `DOCUMENT_SCAN_INFECTED`). Idempotente (pg-boss pode entregar o job mais de uma vez,
// conventions.md §2 "jobs — handlers idempotentes"): se o documento já não está `PENDING` (porque
// outra entrega já tratou, ou foi apagado), não faz nada.
import { auditContextFields } from "../../audit/index.js";
import { finalStorageKey } from "../domain/storage-key.js";
import { detectFileKind } from "../domain/file-type.js";
import type { ScanDocumentDeps } from "./ports.js";
import { readableToBuffer } from "./support.js";

export interface ScanDocumentJob {
  documentId: string;
  familyId: string;
}

/** `audit.record` fora de qualquer pedido HTTP: sem `ip`/`userAgent`, `requestId` sintético. */
function systemRequestId(documentId: string): string {
  return `job:documents.scan:${documentId}`;
}

export function createScanDocumentUseCase<Trx>(deps: ScanDocumentDeps<Trx>) {
  return async function scanDocument(job: ScanDocumentJob): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const document = await deps.documentsRepo.findByIdForFamily(trx, job.familyId, job.documentId);
      if (document?.scanStatus !== "PENDING") {
        // Idempotência: já processado (CLEAN/INFECTED) ou apagado entretanto.
        return;
      }

      const fileStream = await deps.storage.getObject(document.storageKey);
      const buffer = await readableToBuffer(fileStream);
      const result = await deps.virusScanner.scan(buffer);
      const now = deps.clock.now();

      if (result === "INFECTED") {
        // BR-DOC-02/UC-DOC-01: "antivírus positivo -> ficheiro eliminado, upload recusado" — a
        // linha de metadados também é eliminada (ADR-011, hard delete): do ponto de vista do
        // utilizador o upload nunca aconteceu; só o registo de auditoria sobrevive.
        await deps.storage.deleteObject(document.storageKey);
        await deps.documentsRepo.delete(trx, document.familyId, document.memberId, document.id);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "SYSTEM",
          action: "DOCUMENT_SCAN_INFECTED",
          resourceType: "Document",
          resourceId: document.id,
          familyId: document.familyId,
          subjectMemberId: document.memberId,
          result: "SUCCESS",
          requestId: systemRequestId(document.id),
          ...auditContextFields({}),
        });
        return;
      }

      const kind = detectFileKind(buffer);
      // Já validado no upload (upload-document.ts); se o conteúdo mudou entretanto no
      // armazenamento, falha em vez de assumir um tipo — não há forma segura de recuperar aqui.
      if (!kind) {
        throw new Error(`conteúdo deixou de corresponder a um tipo permitido: ${document.id}`);
      }

      const destinationKey = finalStorageKey(document.id, kind);
      await deps.storage.copyObject(document.storageKey, destinationKey);
      await deps.storage.deleteObject(document.storageKey);
      await deps.documentsRepo.markClean(trx, document.id, destinationKey);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "SYSTEM",
        action: "DOCUMENT_SCAN_CLEAN",
        resourceType: "Document",
        resourceId: document.id,
        familyId: document.familyId,
        subjectMemberId: document.memberId,
        result: "SUCCESS",
        requestId: systemRequestId(document.id),
        ...auditContextFields({}),
      });
    });
  };
}
