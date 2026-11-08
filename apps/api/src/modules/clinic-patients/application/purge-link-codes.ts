// Job diário `clinic-patients.purge-link-codes` (modules.md §5, BR-CLN-20): apaga `clinic_link_codes` expirados ou
// usados há mais de 24 h. Idempotente; sem auditoria por linha — uma entrada `SYSTEM` com a contagem.
import type { Clock } from "../../../platform/clock/index.js";
import type { AuditPort, LinkCodesRepository, WithTransaction } from "./ports.js";

export const LINK_CODE_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface PurgeLinkCodesDeps<Trx> {
  codesRepo: LinkCodesRepository<Trx>;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export function createPurgeLinkCodesJobUseCase<Trx>(deps: PurgeLinkCodesDeps<Trx>) {
  return async function purgeLinkCodes(): Promise<{ removed: number }> {
    return deps.withTransaction(async (trx) => {
      const now = deps.clock.now();
      const removed = await deps.codesRepo.purge(trx, new Date(now.getTime() - LINK_CODE_RETENTION_MS));
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "SYSTEM",
        action: "CLINIC_LINK_CODES_PURGE",
        resourceType: "ClinicLinkCode",
        result: "SUCCESS",
        requestId: "job:clinic-patients.purge-link-codes",
        metadata: { removed },
      });
      return { removed };
    });
  };
}
