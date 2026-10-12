// Eliminação de dados (R2/R4/BR-ACC-07/BR-MEM-16): os documentos saem da BD por cascata (FK
// `ON DELETE CASCADE` de `family_members`/`families`), mas os ficheiros no armazenamento não — por
// isso, ANTES de apagar o membro/família, o chamador (`families`/`lifecycle`, pela raiz) enfileira
// aqui os `storage_key` na outbox `file_deletions`, na MESMA transação (ADR-011, schema.md §7).
import type { DocumentsDeps } from "./ports.js";

export function createPurgeFilesUseCases<Trx>(deps: Pick<DocumentsDeps<Trx>, "documentsRepo" | "fileDeletionsRepo">) {
  async function enqueueAll(trx: Trx, keys: string[]): Promise<void> {
    for (const key of keys) {
      await deps.fileDeletionsRepo.enqueue(trx, key);
    }
  }
  return {
    purgeMemberFiles: async (trx: Trx, familyId: string, memberId: string): Promise<void> =>
      enqueueAll(trx, await deps.documentsRepo.listStorageKeysByMember(trx, familyId, memberId)),
    purgeFamilyFiles: async (trx: Trx, familyId: string): Promise<void> =>
      enqueueAll(trx, await deps.documentsRepo.listStorageKeysByFamily(trx, familyId)),
  };
}
