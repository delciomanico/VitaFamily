// Job `expire-exports` (UC-ACC-06: pacote válido 7 dias): apaga do bucket de exportações os pacotes
// expirados e limpa a chave, para não ficarem ficheiros privados para sempre.
import type { Clock } from "../../../platform/clock/index.js";
import type { ExportStorage } from "./ports.js";

export interface ExpireExportsDeps<Trx> {
  repo: {
    listExpired: (trx: Trx, now: Date, limit: number) => Promise<{ id: string; storageKey: string }[]>;
    markExpired: (trx: Trx, id: string) => Promise<void>;
  };
  storage: Pick<ExportStorage, "deleteObject">;
  clock: Clock;
  withTransaction: <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;
}

export function createExpireExportsUseCase<Trx>(deps: ExpireExportsDeps<Trx>) {
  return async function expireExports(): Promise<{ expired: number }> {
    return deps.withTransaction(async (trx) => {
      const items = await deps.repo.listExpired(trx, deps.clock.now(), 50);
      let expired = 0;
      for (const item of items) {
        try {
          await deps.storage.deleteObject(item.storageKey);
          await deps.repo.markExpired(trx, item.id);
          expired++;
        } catch {
          // Tenta de novo na próxima corrida.
        }
      }
      return { expired };
    });
  };
}
