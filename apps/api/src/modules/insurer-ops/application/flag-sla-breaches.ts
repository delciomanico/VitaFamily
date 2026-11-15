// Job `insurer.flag-sla-breaches` (a cada 15 min, BR-AUT-20, Q-V2 A): `IN_REVIEW` com `decisionDueAt <= agora` e sem marca ⇒
// `escalated_at = agora`. É uma MARCA, nunca uma transição: não aprova, não recusa, não atribui (nem 30 dias depois). Idempotente: a
// 2.ª execução já não apanha o pedido marcado. `INFO_REQUESTED` não escala (a espera é da clínica). Sem notificações (fatia 5).
import type { OpsDeps } from "./ports.js";

const BATCH = 100;

type JobDeps<Trx> = Pick<OpsDeps<Trx>, "insurerAuthorizations" | "audit" | "withTransaction" | "clock">;

export function createFlagSlaBreachesJobUseCase<Trx>(deps: JobDeps<Trx>) {
  return async function flagSlaBreaches(): Promise<{ flagged: number }> {
    let flagged = 0;
    for (;;) {
      const count = await deps.withTransaction(async (trx) => {
        const now = deps.clock.now();
        const due = await deps.insurerAuthorizations.lockSlaBreaches(trx, now, BATCH);
        for (const { id, insurerId } of due) {
          await deps.insurerAuthorizations.markEscalated(trx, insurerId, id, now);
          await deps.audit.record(trx, {
            occurredAt: now,
            actorType: "SYSTEM",
            action: "AUTHORIZATION_SLA_BREACH",
            resourceType: "AuthorizationRequest",
            resourceId: id,
            result: "SUCCESS",
            requestId: "job:insurer.flag-sla-breaches",
            metadata: { insurerId },
          });
        }
        return due.length;
      });
      flagged += count;
      if (count < BATCH) return { flagged };
    }
  };
}
