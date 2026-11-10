// Documentos gerados pelo servidor (M15 T, ADR-027, BR-CLN-49): o laudo PDF do exame. EXCEÇÃO documentada a BR-DOC-02/ADR-006:
// o PDF é produzido pelo próprio servidor a partir de texto validado, por isso NÃO passa por quarentena nem ClamAV — grava-se
// diretamente em `documents/` com `scan_status=CLEAN` e checksum. Não conta para o limite de 5 PDF por exame nem bloqueia por
// quota (o tamanho conta para o uso). Chamado por `examinations` DENTRO da transação do exame (autorização é a do portal).
import { ConflictError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { sha256Hex } from "../domain/checksum.js";
import type { Document } from "../domain/document.js";
import { finalStorageKey } from "../domain/storage-key.js";
import type { DocumentsDeps } from "./ports.js";
import { readableToBuffer } from "./support.js";

/** BR-CLN-49: ≤ 256 KB. */
export const MAX_GENERATED_DOCUMENT_BYTES = 256 * 1024;

export interface StoreGeneratedInput {
  familyId: string;
  memberId: string;
  examinationId: string;
  /** Sem dados pessoais. */
  originalName: string;
  bytes: Buffer;
  clinicAccountId: string;
}

export function createStoreGeneratedUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  /**
   * Ordem (modules.md nota 27): bytes gerados -> objeto escrito -> `INSERT` na transação do chamador. Se o `INSERT` falhar, o
   * objeto vai para `file_deletions` (em transação própria, porque a do chamador reverte); quem chamar e falhar DEPOIS deve
   * usar `discardStored` com `storageKey`.
   */
  return async function storeGenerated(trx: Trx, input: StoreGeneratedInput): Promise<Document> {
    if (input.bytes.length === 0 || input.bytes.length > MAX_GENERATED_DOCUMENT_BYTES) {
      throw new ConflictError({ detail: "Documento gerado fora do tamanho permitido." });
    }
    const id = newId();
    const storageKey = finalStorageKey(id, "PDF");
    await deps.storage.putObject(storageKey, input.bytes, "application/pdf");
    try {
      return await deps.documentsRepo.insert(trx, {
        id,
        familyId: input.familyId,
        memberId: input.memberId,
        resourceType: "EXAMINATION",
        resourceId: input.examinationId,
        storageKey,
        originalName: input.originalName,
        mimeType: "application/pdf",
        sizeBytes: input.bytes.length,
        checksumSha256: sha256Hex(input.bytes),
        uploadedByClinic: true,
        uploadedByClinicAccountId: input.clinicAccountId,
        generatedBySystem: true,
        createdAt: deps.clock.now(),
      });
    } catch (error) {
      await discard(deps, storageKey);
      throw error;
    }
  };
}

async function discard<Trx>(deps: DocumentsDeps<Trx>, storageKey: string): Promise<void> {
  await deps.withTransaction((own) => deps.fileDeletionsRepo.enqueue(own, storageKey));
}

/** O objeto já escrito ficou órfão (a transação do chamador reverteu): vai para a outbox `file_deletions`. */
export function createDiscardStoredUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function discardStored(storageKey: string): Promise<void> {
    await discard(deps, storageKey);
  };
}

/** `GET /clinic-portal/exam-agenda/{id}/report/pdf` (BR-CLN-49): o laudo gerado do exame; `null` se apagado pelo titular. */
export function createReadGeneratedExamReportUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function readGeneratedExamReport(trx: Trx, familyId: string, memberId: string, examinationId: string): Promise<{ document: Document; bytes: Buffer } | null> {
    const document = await deps.documentsRepo.findGeneratedByExamination(trx, familyId, memberId, examinationId);
    if (!document) return null;
    return { document, bytes: await readableToBuffer(await deps.storage.getObject(document.storageKey)) };
  };
}
