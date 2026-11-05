// Documentos emitidos pelo portal da clínica (D19/ADR-023, BR-CLN-08, BR-DOC-01..04): a clínica só
// carrega PDF em exames `SCHEDULED` da própria clínica e nunca descarrega — vê só metadados. A
// autorização é a do portal (authorization.md §6, "clínica do token = clínica do exame"), NÃO
// `AccessPolicy`: quem chama passa `resolveTarget`, que corre DENTRO da transação deste módulo e
// verifica o exame (pertence à clínica, está `SCHEDULED`) devolvendo a família/membro — assim a
// verificação e a escrita são atómicas e `documents` continua sem conhecer `examinations`.
// Nunca importado pelas rotas de User (só pela raiz, ligada ao router do portal em `examinations`).
import { ConflictError, DomainError, NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { sha256Hex } from "../domain/checksum.js";
import type { Document } from "../domain/document.js";
import { detectFileKind, mimeTypeForFileKind } from "../domain/file-type.js";
import { quarantineStorageKey } from "../domain/storage-key.js";
import type { DocumentsDeps, NewDocumentRecord, RequestContext } from "./ports.js";

/** "20 uploads/hora" (openapi.yaml `uploadClinicExamDocument`) — por conta de clínica. */
const CLINIC_UPLOAD_RATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 };

export interface ClinicDocumentTarget {
  familyId: string;
  memberId: string;
}

export interface ClinicActorRef {
  clinicAccountId: string;
}

export interface UploadClinicExamDocumentInput {
  examinationId: string;
  file: { buffer: Buffer; originalName: string };
}

export function createUploadClinicExamDocumentUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function uploadClinicExamDocument(
    actor: ClinicActorRef,
    input: UploadClinicExamDocumentInput,
    resolveTarget: (trx: Trx) => Promise<ClinicDocumentTarget>,
    context: RequestContext,
  ): Promise<Document> {
    const decision = deps.rateLimiter.consume(`clinic-upload:${actor.clinicAccountId}`, CLINIC_UPLOAD_RATE_LIMIT);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.retryAfterMs, { detail: "Demasiados carregamentos; tente mais tarde." });
    }

    // BR-CLN-08: só PDF (tipo verificado pelo CONTEÚDO, BR-DOC-01).
    const kind = detectFileKind(input.file.buffer);
    if (kind !== "PDF") {
      throw new DomainError("FILE_TYPE_NOT_ALLOWED", { detail: "Tipo de ficheiro não permitido (só PDF)." });
    }
    if (input.file.buffer.length > deps.maxFileSizeBytes) {
      throw new DomainError("FILE_TOO_LARGE", { detail: "Ficheiro acima do limite permitido (10 MB)." });
    }

    const document = await deps.withTransaction(async (trx) => {
      const target = await resolveTarget(trx);

      // BR-DOC-03: 5 por exame. Quota da família (Q10) nunca revelada à clínica: CONFLICT genérico.
      const existingCount = await deps.documentsRepo.countByResource(trx, target.familyId, target.memberId, "EXAMINATION", input.examinationId);
      if (existingCount >= deps.maxFilesPerResource) {
        throw new DomainError("DOCUMENT_LIMIT_EXCEEDED", { detail: "Máximo de 5 ficheiros por exame." });
      }
      const familyTotalBytes = await deps.documentsRepo.sumSizeByFamily(trx, target.familyId);
      if (familyTotalBytes + input.file.buffer.length > deps.maxFamilyStorageBytes) {
        throw new ConflictError({ detail: "Não foi possível carregar o ficheiro." });
      }

      const now = deps.clock.now();
      const id = newId();
      const storageKey = quarantineStorageKey(id, kind);
      const mimeType = mimeTypeForFileKind(kind);
      await deps.storage.putObject(storageKey, input.file.buffer, mimeType);

      const record: NewDocumentRecord = {
        id,
        familyId: target.familyId,
        memberId: target.memberId,
        resourceType: "EXAMINATION",
        resourceId: input.examinationId,
        storageKey,
        originalName: input.file.originalName,
        mimeType,
        sizeBytes: input.file.buffer.length,
        checksumSha256: sha256Hex(input.file.buffer),
        uploadedByClinic: true,
        uploadedByClinicAccountId: actor.clinicAccountId,
        createdAt: now,
      };
      const inserted = await deps.documentsRepo.insert(trx, record);

      // audit.md §3 (D19): portal sem `family_id`/`subject_member_id`; sem nomes de ficheiro (podem ter PII).
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "EXAM_DOCUMENT_UPLOAD",
        resourceType: "Document",
        resourceId: inserted.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { examinationId: input.examinationId },
      });
      return inserted;
    });

    // Só depois do commit (mesmo critério de `uploadDocument`): ClamAV analisa em quarentena.
    await deps.scanQueue.enqueueScan({ documentId: document.id, familyId: document.familyId });
    return document;
  };
}

export interface DeleteClinicExamDocumentInput {
  examinationId: string;
  documentId: string;
}

/** BR-CLN-08: só os PDF carregados pelo portal da clínica, enquanto o exame está `SCHEDULED`. */
export function createDeleteClinicExamDocumentUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function deleteClinicExamDocument(
    actor: ClinicActorRef,
    input: DeleteClinicExamDocumentInput,
    resolveTarget: (trx: Trx) => Promise<ClinicDocumentTarget>,
    context: RequestContext,
  ): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const target = await resolveTarget(trx);
      const document = await deps.documentsRepo.findById(trx, target.familyId, target.memberId, input.documentId);
      if (document?.resourceType !== "EXAMINATION" || document.resourceId !== input.examinationId || !document.uploadedByClinic) {
        throw new NotFoundError({ detail: "Documento não encontrado." });
      }

      // Outbox antes de apagar a linha (ADR-011, NFR-DATA-05).
      await deps.fileDeletionsRepo.enqueue(trx, document.storageKey);
      await deps.documentsRepo.delete(trx, target.familyId, target.memberId, document.id);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        action: "DOCUMENT_DELETE",
        resourceType: "Document",
        resourceId: document.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { examinationId: input.examinationId },
      });
    });
  };
}
