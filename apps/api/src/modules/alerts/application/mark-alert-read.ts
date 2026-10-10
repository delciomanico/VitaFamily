// UC-ALR-04: marcar um alerta (meu) como lido. `NOT_FOUND` se não existir ou não for meu (nunca
// enumerar, errors.md regra 2). `204` sem corpo (endpoints.md `markAlertRead`). Ao marcar como
// lido antes do envio, cancela as notificações ainda pendentes
// (`notifications.skipPendingForAlert`, modules.md §2 nota 15; state-machines.md "Notification"
// SKIPPED).
import { NotFoundError } from "../../../platform/errors/index.js";
import type { AlertsApiDeps } from "./ports.js";

export function createMarkAlertReadUseCase<Trx>(deps: AlertsApiDeps<Trx>) {
  return async function markAlertRead(recipientUserId: string, alertId: string): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const existing = await deps.alertsRepo.findById(trx, recipientUserId, alertId);
      if (!existing) {
        throw new NotFoundError({ detail: "Alerta não encontrado." });
      }
      if (!existing.readAt) {
        await deps.alertsRepo.markRead(trx, alertId, deps.clock.now());
      }
      await deps.notifications.skipPendingForAlert(trx, alertId);
    });
  };
}
