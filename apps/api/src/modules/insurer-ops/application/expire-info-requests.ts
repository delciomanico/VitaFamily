// Job `insurer.expire-info-requests` (00:50 UTC, BR-AUT-14): `INFO_REQUESTED` sem resposta até `infoExpiresAt` → `CANCELLED` com
// `closedReason=INFO_TIMEOUT` (evento `SYSTEM`). Idempotente: o estado muda, logo uma 2.ª execução não o volta a apanhar. O limite
// foi guardado ao entrar em `INFO_REQUESTED`: mudar a política depois não o altera. Sem ator HTTP (job de sistema).
import type { OpsDeps } from "./ports.js";
import { assertTransition, recordTransition } from "./authorization-support.js";

const BATCH = 100;

type JobDeps<Trx> = Pick<OpsDeps<Trx>, "authorizations" | "audit" | "withTransaction" | "clock">;

export function createExpireInfoRequestsJobUseCase<Trx>(deps: JobDeps<Trx>) {
  return async function expireInfoRequests(): Promise<{ expired: number }> {
    let expired = 0;
    for (;;) {
      const count = await deps.withTransaction(async (trx) => {
        const now = deps.clock.now();
        const due = await deps.authorizations.lockExpiredInfoRequests(trx, now, BATCH);
        for (const { id, insurerId } of due) {
          assertTransition("INFO_REQUESTED", "CANCELLED", "SYSTEM", "INFO_TIMEOUT");
          await deps.authorizations.updateStatus(trx, insurerId, id, { status: "CANCELLED", closedReason: "INFO_TIMEOUT", infoExpiresAt: null, now });
          await recordTransition(deps, trx, { insurerId, authorizationId: id, from: "INFO_REQUESTED", to: "CANCELLED", actor: "SYSTEM", actorAccountId: null, note: null, closedReason: "INFO_TIMEOUT", now });
          await deps.audit.record(trx, {
            occurredAt: now,
            actorType: "SYSTEM",
            action: "AUTHORIZATION_INFO_TIMEOUT",
            resourceType: "AuthorizationRequest",
            resourceId: id,
            result: "SUCCESS",
            requestId: "job:insurer.expire-info-requests",
            metadata: { insurerId },
          });
        }
        return due.length;
      });
      expired += count;
      if (count < BATCH) return { expired };
    }
  };
}
