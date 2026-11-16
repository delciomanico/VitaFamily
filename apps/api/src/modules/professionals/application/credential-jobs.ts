// Jobs de credenciais (OP-58): antivírus `professionals.scan-credential` e outbox `professionals.delete-files`. Idempotentes (pg-boss pode
// entregar mais de uma vez).
import type { Readable } from "node:stream";
import type { Clock } from "../../../platform/clock/index.js";
import { finalKey, detectFileKind } from "../domain/file-type.js";
import type { CredentialFileStore, CredentialRepository, CredentialScanner, FileDeletionRepository, WithTransaction } from "./ports.js";

export interface CredentialJobsDeps<Trx> {
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  credentialRepo: CredentialRepository<Trx>;
  fileDeletionRepo: FileDeletionRepository<Trx>;
  fileStore: CredentialFileStore;
  scanner: CredentialScanner;
}

async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * `PENDING → CLEAN | INFECTED` (state-machines.md «ProfessionalCredential»). CLEAN: copia para a chave final e a quarentena apaga-se pela
 * outbox. INFECTED: a linha FICA (para o profissional perceber o que falhou), o objeto apaga-se pela outbox e conta como em falta.
 */
export function createScanCredentialUseCase<Trx>(deps: CredentialJobsDeps<Trx>) {
  return async function scanCredential(job: { credentialId: string }): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const credential = await deps.credentialRepo.findByIdForScan(trx, job.credentialId);
      if (credential?.scanStatus !== "PENDING") return; // idempotência: já tratada ou removida entretanto
      const buffer = await toBuffer(await deps.fileStore.get(credential.storageKey));
      const now = deps.clock.now();
      if ((await deps.scanner.scan(buffer)) === "INFECTED") {
        await deps.credentialRepo.markInfected(trx, credential.id, now);
        await deps.fileDeletionRepo.enqueue(trx, credential.storageKey);
        return;
      }
      const kind = detectFileKind(buffer);
      if (!kind) throw new Error(`conteúdo deixou de corresponder a um tipo permitido: ${credential.id}`);
      const destination = finalKey(credential.id, kind);
      await deps.fileStore.copy(credential.storageKey, destination);
      await deps.credentialRepo.markClean(trx, credential.id, destination, now);
      await deps.fileDeletionRepo.enqueue(trx, credential.storageKey);
    });
  };
}

export const DELETE_FILES_BATCH = 50;
export const DELETE_FILES_MAX_ATTEMPTS = 10;

export function createDeleteFilesUseCase<Trx>(deps: Pick<CredentialJobsDeps<Trx>, "withTransaction" | "clock" | "fileDeletionRepo" | "fileStore">) {
  return async function deleteFiles(): Promise<{ deleted: number; failed: number }> {
    return deps.withTransaction(async (trx) => {
      const pending = await deps.fileDeletionRepo.listPending(trx, DELETE_FILES_BATCH, DELETE_FILES_MAX_ATTEMPTS);
      let deleted = 0;
      let failed = 0;
      for (const item of pending) {
        try {
          await deps.fileStore.delete(item.storageKey);
          await deps.fileDeletionRepo.markDeleted(trx, item.id, deps.clock.now());
          deleted += 1;
        } catch {
          await deps.fileDeletionRepo.recordFailure(trx, item.id);
          failed += 1;
        }
      }
      return { deleted, failed };
    });
  };
}
