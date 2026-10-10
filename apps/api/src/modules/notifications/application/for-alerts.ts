// API pública para `alerts` consumir pela raiz (modules.md §2 nota 15: `alerts -> notifications`,
// a orquestração do pipeline Evento→Regra→Alerta→Notificação fica em `alerts`, nunca o inverso —
// `notifications` nunca lê a tabela `alerts`, conventions.md §3.5). Processo "worker"
// (`alerts.scan`, modules.md §4/§5) — sem ator a autorizar.
import { newId } from "../../../platform/ids/index.js";
import { activeChannels, defaultPreference, isTypeEnabled, type AlertNotificationType } from "../domain/preference.js";
import type { NotificationsWorkerDeps } from "./ports.js";

export function createIsTypeEnabledUseCase<Trx>(deps: NotificationsWorkerDeps<Trx>) {
  return async function isTypeEnabledFor(trx: Trx, userId: string, type: AlertNotificationType): Promise<boolean> {
    const preference = (await deps.preferencesRepo.findByUserId(trx, userId)) ?? defaultPreference(userId);
    return isTypeEnabled(preference, type);
  };
}

export interface EnqueueForAlertInput {
  alertId: string;
  recipientUserId: string;
}

/**
 * Cria uma linha `notifications` por canal ativo do destinatário (UC-ALR-01 pós-condição;
 * `UNIQUE (alert_id, channel)` torna isto idempotente — repetir para o mesmo alerta não duplica).
 * Sem canal ativo ⇒ nenhuma linha (UC-ALR-02 alternativo: "o alerta existe na app, sem
 * notificação externa").
 */
export function createEnqueueForAlertUseCase<Trx>(deps: NotificationsWorkerDeps<Trx>) {
  return async function enqueueForAlert(trx: Trx, input: EnqueueForAlertInput): Promise<void> {
    const preference = (await deps.preferencesRepo.findByUserId(trx, input.recipientUserId)) ?? defaultPreference(input.recipientUserId);
    const now = deps.clock.now();
    for (const channel of activeChannels(preference)) {
      await deps.notificationsRepo.insertIfNew(trx, {
        id: newId(),
        alertId: input.alertId,
        recipientUserId: input.recipientUserId,
        channel,
        createdAt: now,
      });
    }
  };
}

/**
 * `alerts.markAlertRead`/`markAllAlertsRead` chamam isto (modules.md §2 nota 15): SKIPPED para as
 * notificações ainda não enviadas de um alerta lido antes do envio (state-machines.md
 * "Notification" SKIPPED; UC-ALR-04).
 */
export function createSkipPendingForAlertUseCase<Trx>(deps: NotificationsWorkerDeps<Trx>) {
  return async function skipPendingForAlert(trx: Trx, alertId: string): Promise<void> {
    await deps.notificationsRepo.skipPendingByAlertId(trx, alertId);
  };
}
