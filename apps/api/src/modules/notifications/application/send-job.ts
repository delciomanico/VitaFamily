// Job `notifications.send` (modules.md §5, "fila"; ADR-009 mesmo critério aplicado aqui — scanner
// sobre estado persistente, recuperável, em vez de depender da entrega de uma fila externa):
// processa `notifications` PENDING/FAILED devidas (`listDueForSending`) e tenta entregar por
// canal. N8/BR-ALR-08: texto sempre genérico, sem nome do membro, medicamento ou hora — só dentro
// da app (`alerts`) é que há detalhe. "Falha de um canal não impede o outro" (BR-ALR-05): cada
// `Notification` falha/repete isoladamente, nunca em bloco.
import { decideRetry } from "../domain/notification.js";
import type { Notification } from "../domain/notification.js";
import type { NotificationsWorkerDeps } from "./ports.js";

const BATCH_SIZE = 200;

/** N8/BR-ALR-08: mensagem fixa, igual para todos os tipos — nenhuma informação além de "tens uma
 * notificação nova" (nome, medicamento e hora só dentro da app, nunca aqui). */
const GENERIC_PUSH_PAYLOAD = JSON.stringify({ title: "Vita Family", body: "Tem uma notificação nova. Abra a app para ver os detalhes." });
const GENERIC_EMAIL_SUBJECT = "Vita Family — tem uma notificação nova";
const GENERIC_EMAIL_BODY = "Tem uma notificação nova no Vita Family. Abra a aplicação para ver os detalhes.";

export interface SendJobResult {
  sent: number;
  skipped: number;
  retried: number;
  failedTerminal: number;
}

export function createSendJobUseCase<Trx>(deps: NotificationsWorkerDeps<Trx>) {
  async function handleFailure(trx: Trx, notification: Notification, now: Date, errorCode: string): Promise<"retried" | "failedTerminal"> {
    const attempts = notification.attempts + 1;
    const decision = decideRetry(attempts, now);
    if (decision.terminal) {
      await deps.notificationsRepo.markFailedTerminal(trx, notification.id, attempts, errorCode);
      return "failedTerminal";
    }
    await deps.notificationsRepo.markRetry(trx, notification.id, attempts, decision.nextAttemptAt, errorCode);
    return "retried";
  }

  return async function sendJob(): Promise<SendJobResult> {
    const now = deps.clock.now();
    const result: SendJobResult = { sent: 0, skipped: 0, retried: 0, failedTerminal: 0 };

    await deps.withTransaction(async (trx) => {
      const due = await deps.notificationsRepo.listDueForSending(trx, now, BATCH_SIZE);

      for (const notification of due) {
        const user = await deps.users.byId(trx, notification.recipientUserId);
        // state-machines.md "Notification" SKIPPED: "conta suspensa" (ou já eliminada).
        if (!user || user.status === "SUSPENDED") {
          await deps.notificationsRepo.markSkipped(trx, notification.id, "ACCOUNT_SUSPENDED");
          result.skipped += 1;
          continue;
        }

        const preference = await deps.preferencesRepo.findByUserId(trx, notification.recipientUserId);
        const channelEnabled = notification.channel === "PUSH" ? (preference?.pushEnabled ?? true) : (preference?.emailEnabled ?? true);
        // SKIPPED: "canal desativado" — reavaliado no envio (pode ter mudado desde a criação).
        if (!channelEnabled) {
          await deps.notificationsRepo.markSkipped(trx, notification.id, "CHANNEL_DISABLED");
          result.skipped += 1;
          continue;
        }

        if (notification.channel === "EMAIL") {
          try {
            await deps.mailer.send(user.email, GENERIC_EMAIL_SUBJECT, GENERIC_EMAIL_BODY);
            await deps.notificationsRepo.markSent(trx, notification.id, now);
            result.sent += 1;
          } catch {
            const outcome = await handleFailure(trx, notification, now, "EMAIL_SEND_FAILED");
            result[outcome] += 1;
          }
          continue;
        }

        // PUSH: um destinatário pode ter várias subscrições (vários dispositivos); basta uma
        // entrega para SENT. Subscrições inválidas/expiradas são removidas (UC-ALR-06: "regra").
        const subscriptions = await deps.pushSubscriptionsRepo.listByUserId(trx, notification.recipientUserId);
        if (subscriptions.length === 0) {
          // SKIPPED: "sem subscrição push".
          await deps.notificationsRepo.markSkipped(trx, notification.id, "NO_PUSH_SUBSCRIPTION");
          result.skipped += 1;
          continue;
        }

        let delivered = false;
        for (const subscription of subscriptions) {
          const sendResult = await deps.pushSender.send(subscription, GENERIC_PUSH_PAYLOAD);
          if (sendResult.delivered) {
            delivered = true;
            await deps.pushSubscriptionsRepo.markSuccess(trx, subscription.id, now);
          } else if (sendResult.invalidSubscription) {
            await deps.pushSubscriptionsRepo.deleteByEndpoint(trx, subscription.endpoint);
          }
        }

        if (delivered) {
          await deps.notificationsRepo.markSent(trx, notification.id, now);
          result.sent += 1;
        } else {
          const outcome = await handleFailure(trx, notification, now, "PUSH_SEND_FAILED");
          result[outcome] += 1;
        }
      }
    });

    return result;
  };
}
