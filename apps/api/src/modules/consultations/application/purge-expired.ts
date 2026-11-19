// Job diário `consultations.purge-expired` (BR-MKT-64, UC-MKT-46; OP-99): os FICHEIROS dos comprovativos de marcações com `startsAt` há MAIS de
// 24 meses saem pela outbox (`consultation_file_deletions`) e a linha fica sem ficheiro (`purged_at`); os metadados, as marcações e as
// avaliações não se tocam. Idempotente; auditoria `SYSTEM` só com a contagem (nunca chaves, ids nem nomes, BR-MKT-63).
import type { AuditPort, ConsultationsClock, FileDeletionRepository, ProofRepository, WithTransaction } from "./ports.js";

export const PROOF_RETENTION_MONTHS = 24;

/** `now` menos 24 meses de calendário (UTC). Uma marcação com `startsAt` EXATAMENTE neste instante mantém os ficheiros. */
export function proofRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - PROOF_RETENTION_MONTHS);
  return cutoff;
}

export interface PurgeExpiredDeps<Trx> {
  withTransaction: WithTransaction<Trx>;
  clock: ConsultationsClock;
  audit: AuditPort<Trx>;
  proofs: Pick<ProofRepository<Trx>, "purgeFilesBefore">;
  fileDeletions: Pick<FileDeletionRepository<Trx>, "enqueue">;
}

export function createPurgeExpiredProofs<Trx>(deps: PurgeExpiredDeps<Trx>) {
  return async function purgeExpiredProofs(): Promise<{ count: number }> {
    return deps.withTransaction(async (trx) => {
      const now = deps.clock.now();
      const keys = await deps.proofs.purgeFilesBefore(trx, proofRetentionCutoff(now), now);
      for (const key of keys) await deps.fileDeletions.enqueue(trx, key);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "SYSTEM",
        action: "PROOF_FILES_PURGED",
        resourceType: "Booking",
        result: "SUCCESS",
        requestId: "job:consultations.purge-expired",
        metadata: { count: keys.length },
      });
      return { count: keys.length };
    });
  };
}
