// Job `medications.mark-unconfirmed` (modules.md §5, a cada 5 min; UC-MED-09/BR-MED-03/04, Q2):
// PENDING com `scheduled_at + 2h <= now` passa a UNCONFIRMED. Puramente de sistema — BR-MED-06/D7-B:
// não gera alerta nem é uma ação sensível de auditoria (audit.md §3 só lista `DOSE_TAKEN`/
// `DOSE_NOT_TAKEN`/`DOSE_CORRECTED`, nunca esta transição automática); o estado fica só no
// histórico da própria ocorrência (BR-HLT-01).
import { UNCONFIRMED_THRESHOLD_MS } from "../domain/dose-occurrence.js";
import type { MedicationsWorkerDeps } from "./ports.js";

const BATCH_SIZE = 500;

export interface MarkUnconfirmedJobResult {
  marked: number;
}

export function createMarkUnconfirmedJobUseCase<Trx>(deps: MedicationsWorkerDeps<Trx>) {
  return async function markUnconfirmedJob(): Promise<MarkUnconfirmedJobResult> {
    const now = deps.clock.now();
    const threshold = new Date(now.getTime() - UNCONFIRMED_THRESHOLD_MS);

    return deps.withTransaction(async (trx) => {
      const pending = await deps.dosesRepo.listPendingBefore(trx, threshold, BATCH_SIZE);
      for (const dose of pending) {
        await deps.dosesRepo.updateStatus(trx, dose.id, "UNCONFIRMED", null, null, null);
      }
      return { marked: pending.length };
    });
  };
}
