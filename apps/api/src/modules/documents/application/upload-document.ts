// openapi.yaml `uploadDocument`: "Autorização: WRITE(categoria do recurso). M5, N4, Q10: tipo
// verificado pelo conteúdo; nasce PENDING até o antivírus aprovar; 20 uploads/hora."
// UC-DOC-01, AC-DOC-01, AC-DOC-03, BR-DOC-01, BR-DOC-02, BR-DOC-03.
import { DomainError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { sha256Hex } from "../domain/checksum.js";
import type { Document, ResourceType } from "../domain/document.js";
import { detectFileKind, mimeTypeForFileKind } from "../domain/file-type.js";
import { quarantineStorageKey } from "../domain/storage-key.js";
import type { ActorIdentity, DocumentsDeps, NewDocumentRecord, RequestContext } from "./ports.js";
import { categoryForResourceType } from "./support.js";

/** "20 uploads/hora" (openapi.yaml `uploadDocument`) — por utilizador que carrega, não por família. */
const UPLOAD_RATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 };

export interface UploadDocumentFileInput {
  buffer: Buffer;
  originalName: string;
}

export interface UploadDocumentInput {
  resourceType: ResourceType;
  resourceId: string;
  file: UploadDocumentFileInput;
}

export function createUploadDocumentUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function uploadDocument(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: UploadDocumentInput,
    context: RequestContext,
  ): Promise<Document> {
    if (!input.resourceId) {
      throw new ValidationError([{ field: "resourceId", message: "obrigatório" }], { detail: "Dados inválidos." });
    }

    // Rate limit antes de qualquer I/O (barato, evita gastar storage/BD em pedidos a mais).
    const decision = deps.rateLimiter.consume(`upload:${actor.userId}`, UPLOAD_RATE_LIMIT);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.retryAfterMs, { detail: "Demasiados carregamentos; tente mais tarde." });
    }

    // BR-DOC-01: tipo verificado pelo CONTEÚDO, nunca pela extensão/Content-Type declarado.
    const kind = detectFileKind(input.file.buffer);
    if (!kind) {
      throw new DomainError("FILE_TYPE_NOT_ALLOWED", { detail: "Tipo de ficheiro não permitido (só PDF, JPG, PNG)." });
    }
    if (input.file.buffer.length > deps.maxFileSizeBytes) {
      throw new DomainError("FILE_TOO_LARGE", { detail: "Ficheiro acima do limite permitido (10 MB)." });
    }

    const category = categoryForResourceType(input.resourceType);

    const document = await deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "CREATE",
        subjectMemberId: memberId,
        category,
      });

      // BR-DOC-03/Q10: 5 ficheiros por recurso, 100 MB por família.
      const existingCount = await deps.documentsRepo.countByResource(trx, familyId, memberId, input.resourceType, input.resourceId);
      if (existingCount >= deps.maxFilesPerResource) {
        throw new DomainError("DOCUMENT_LIMIT_EXCEEDED", { detail: "Máximo de 5 ficheiros por recurso." });
      }
      const familyTotalBytes = await deps.documentsRepo.sumSizeByFamily(trx, familyId);
      if (familyTotalBytes + input.file.buffer.length > deps.maxFamilyStorageBytes) {
        throw new DomainError("STORAGE_QUOTA_EXCEEDED", { detail: "Quota de armazenamento da família excedida (100 MB)." });
      }

      const now = deps.clock.now();
      const id = newId();
      const storageKey = quarantineStorageKey(id, kind);
      const mimeType = mimeTypeForFileKind(kind);
      const checksum = sha256Hex(input.file.buffer);

      // ADR-006: ficheiro em quarentena até o antivírus aprovar; metadados só depois de o objeto
      // estar escrito (se o putObject falhar, a transação não chega a ter a linha de `documents`).
      await deps.storage.putObject(storageKey, input.file.buffer, mimeType);

      const record: NewDocumentRecord = {
        id,
        familyId,
        memberId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        storageKey,
        originalName: input.file.originalName,
        mimeType,
        sizeBytes: input.file.buffer.length,
        checksumSha256: checksum,
        createdAt: now,
        uploadedBy: actor.userId,
      };
      const inserted = await deps.documentsRepo.insert(trx, record);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "DOCUMENT_UPLOAD",
        resourceType: "Document",
        resourceId: inserted.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return inserted;
    });

    // Fora da transação: só depois de a linha `documents` estar comitada é que o scan tem sentido
    // (se o pg-boss falhasse a meio da transação SQL, um rollback deixaria um job órfão).
    await deps.scanQueue.enqueueScan({ documentId: document.id, familyId });

    return document;
  };
}
