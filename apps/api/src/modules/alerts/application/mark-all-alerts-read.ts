// UC-ALR-04 (variante "marcar todos"): endpoints.md `markAllAlertsRead`.
import type { AlertsApiDeps } from "./ports.js";

export function createMarkAllAlertsReadUseCase<Trx>(deps: AlertsApiDeps<Trx>) {
  return async function markAllAlertsRead(recipientUserId: string): Promise<void> {
    await deps.withTransaction(async (trx) => {
      const markedIds = await deps.alertsRepo.markAllRead(trx, recipientUserId, deps.clock.now());
      for (const alertId of markedIds) {
        await deps.notifications.skipPendingForAlert(trx, alertId);
      }
    });
  };
}
