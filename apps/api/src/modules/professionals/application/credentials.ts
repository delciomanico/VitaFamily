// Credenciais do profissional (UC-MKT-04, BR-MKT-17): carregar, listar, remover e descarregar as PRÓPRIAS. Isolamento por `professionalId`
// do token (recurso de outro profissional ou inexistente ⇒ `NOT_FOUND`, sem enumeração). Ficheiro validado por conteúdo, em quarentena até o
// antivírus (job `professionals.scan-credential`). Nunca se guardam nem auditam o nome do ficheiro, o nº nem a entidade.
import type { Readable } from "node:stream";
import { DomainError, NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { validateCredentialMetadata } from "../domain/credential.js";
import { MIME_BY_KIND, detectFileKind, quarantineKey } from "../domain/file-type.js";
import { MAX_CREDENTIALS } from "../domain/requirements.js";
import { assertCanWrite } from "../domain/validation-status.js";
import { auditDeniedOnLock } from "./denied.js";
import type { CredentialRecord, ProfessionalsDeps, RequestContext } from "./ports.js";
import type { ProfessionalActor } from "./profile.js";

/** 20 uploads/hora por conta (authentication.md §5). */
const UPLOAD_RATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 };

export function createListCredentialsUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function listCredentials(actor: ProfessionalActor): Promise<CredentialRecord[]> {
    return deps.withTransaction((trx) => deps.credentialRepo.listByProfessional(trx, actor.professionalId));
  };
}

export interface UploadCredentialInput {
  fields: Record<string, unknown>;
  file: { buffer: Buffer };
}

export function createUploadCredentialUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function uploadCredential(actor: ProfessionalActor, input: UploadCredentialInput, context: RequestContext): Promise<CredentialRecord> {
    const decision = deps.rateLimiter.consume(`credential-upload:${actor.professionalAccountId}`, UPLOAD_RATE_LIMIT);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.retryAfterMs, { detail: "Demasiados carregamentos; tente mais tarde." });
    }
    const metadata = validateCredentialMetadata(input.fields);
    // BR-MKT-17: tipo verificado pelo CONTEÚDO, nunca pela extensão nem pelo Content-Type declarado.
    const kind = detectFileKind(input.file.buffer);
    if (!kind) {
      throw new DomainError("FILE_TYPE_NOT_ALLOWED", { detail: "Tipo de ficheiro não permitido (só PDF, JPG, PNG)." });
    }
    if (input.file.buffer.length > deps.maxFileSizeBytes) {
      throw new DomainError("FILE_TOO_LARGE", { detail: "Ficheiro acima do limite permitido (10 MB)." });
    }

    const now = deps.clock.now();
    const id = newId();
    const storageKey = quarantineKey(id, kind);
    const state = { stored: false };

    let credential: CredentialRecord;
    try {
      credential = await auditDeniedOnLock(deps, actor, context, "UPLOAD_CREDENTIAL", () =>
        deps.withTransaction(async (trx) => {
          const professional = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
          if (!professional) throw new NotFoundError();
          assertCanWrite(professional.validationStatus, "EDIT_IDENTITY");
          if ((await deps.credentialRepo.countByProfessional(trx, professional.id)) >= MAX_CREDENTIALS) {
            throw new DomainError("LIMIT_EXCEEDED", { detail: "Máximo de 10 credenciais." });
          }
          // Quarentena primeiro; a linha só existe depois de o objeto estar escrito (se a transação falhar, o `catch` abaixo limpa o objeto).
          await deps.fileStore.put(storageKey, input.file.buffer, MIME_BY_KIND[kind]);
          state.stored = true;
          const inserted = await deps.credentialRepo.insert(trx, {
            id,
            professionalId: professional.id,
            kind: metadata.kind,
            number: metadata.number,
            issuingBody: metadata.issuingBody,
            validUntil: metadata.validUntil,
            storageKey,
            contentType: MIME_BY_KIND[kind],
            sizeBytes: input.file.buffer.length,
            createdAt: now,
          });
          await deps.audit.record(trx, {
            occurredAt: now,
            actorType: "PROFESSIONAL_ACCOUNT",
            actorProfessionalAccountId: actor.professionalAccountId,
            action: "PROFESSIONAL_CREDENTIAL_UPLOAD",
            resourceType: "ProfessionalCredential",
            resourceId: inserted.id,
            result: "SUCCESS",
            requestId: context.requestId,
            metadata: { kind: metadata.kind },
            ...auditContextFields(context),
          });
          return inserted;
        }),
      );
    } catch (error) {
      if (state.stored) {
        // Objeto órfão (a transação reverteu): limpeza imediata; se falhar, a outbox apaga-o (nunca fica em quarentena para sempre).
        await deps.fileStore.delete(storageKey).catch(async () => {
          await deps.withTransaction((trx) => deps.fileDeletionRepo.enqueue(trx, storageKey));
        });
      }
      throw error;
    }
    // Fora da transação: só depois de a linha estar comitada faz sentido o antivírus. Se a fila falhar, a credencial fica PENDING
    // (não satisfaz BR-MKT-16) e o profissional pode removê-la e voltar a carregar.
    await deps.scanQueue.enqueueScan({ credentialId: credential.id });
    return credential;
  };
}

export function createDeleteCredentialUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function deleteCredential(actor: ProfessionalActor, credentialId: string, context: RequestContext): Promise<void> {
    const now = deps.clock.now();
    await auditDeniedOnLock(deps, actor, context, "DELETE_CREDENTIAL", () =>
      deps.withTransaction(async (trx) => {
        const professional = await deps.profileRepo.findByIdForUpdate(trx, actor.professionalId);
        if (!professional) throw new NotFoundError();
        // `FOR UPDATE`: serializa com o job de antivírus (que pode estar a mover o objeto para a chave final).
        const credential = await deps.credentialRepo.findOwned(trx, professional.id, credentialId, { forUpdate: true });
        if (!credential) throw new NotFoundError();
        assertCanWrite(professional.validationStatus, "EDIT_IDENTITY");
        await deps.credentialRepo.delete(trx, professional.id, credential.id);
        // Remoção definitiva do objeto por outbox própria (mesma transação ⇒ nunca se perde o pedido de apagar).
        await deps.fileDeletionRepo.enqueue(trx, credential.storageKey);
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_CREDENTIAL_DELETE",
          resourceType: "ProfessionalCredential",
          resourceId: credential.id,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { kind: credential.kind },
          ...auditContextFields(context),
        });
      }),
    );
  };
}

export interface CredentialDownload {
  stream: Readable;
  contentType: CredentialRecord["contentType"];
  kind: CredentialRecord["kind"];
}

export function createDownloadCredentialUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function downloadCredential(actor: ProfessionalActor, credentialId: string, context: RequestContext): Promise<CredentialDownload> {
    const now = deps.clock.now();
    return deps.withTransaction(async (trx) => {
      const found = await deps.credentialRepo.findOwned(trx, actor.professionalId, credentialId);
      if (!found) throw new NotFoundError();
      // `PENDING`/`INFECTED` nunca se descarregam (BR-MKT-17).
      if (found.scanStatus !== "CLEAN") {
        throw new DomainError("DOCUMENT_NOT_AVAILABLE", { detail: "O ficheiro ainda não está disponível." });
      }
      // Abre o objeto ANTES de auditar: se o armazenamento falhar não fica registado um download que não aconteceu.
      const stream = await deps.fileStore.get(found.storageKey);
      try {
        // Todo o download é auditado (BR-MKT-17), antes de entregar o ficheiro.
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_CREDENTIAL_DOWNLOAD",
          resourceType: "ProfessionalCredential",
          resourceId: found.id,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      } catch (error) {
        stream.destroy();
        throw error;
      }
      return { stream, contentType: found.contentType, kind: found.kind };
    });
  };
}
