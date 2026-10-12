// Job `delete-files` (modules.md §5, ADR-011): esvazia a outbox `file_deletions` — apaga o ficheiro
// no armazenamento e marca como feito. Idempotente (apagar um objeto inexistente não é erro no S3);
// falhas incrementam `attempts` e voltam a ser tentadas até MAX_ATTEMPTS.
import type { DeleteFilesDeps } from "./ports.js";

export const DELETE_FILES_BATCH = 50;
export const DELETE_FILES_MAX_ATTEMPTS = 10;

export function createDeleteFilesUseCase<Trx>(deps: DeleteFilesDeps<Trx>) {
  return async function deleteFiles(): Promise<{ deleted: number; failed: number }> {
    return deps.withTransaction(async (trx) => {
      const pending = await deps.fileDeletionsRepo.listPending(trx, DELETE_FILES_BATCH, DELETE_FILES_MAX_ATTEMPTS);
      let deleted = 0;
      let failed = 0;
      for (const item of pending) {
        try {
          await deps.storage.deleteObject(item.storageKey);
          await deps.fileDeletionsRepo.markDeleted(trx, item.id, deps.clock.now());
          deleted++;
        } catch {
          await deps.fileDeletionsRepo.recordFailure(trx, item.id);
          failed++;
        }
      }
      return { deleted, failed };
    });
  };
}
