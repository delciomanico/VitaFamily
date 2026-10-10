// Entidade pura `Notification` (entities.md "Alertas"; schema.md §4; state-machines.md
// "Notification"; ST6) e a aritmética pura de retry/backoff. Sem I/O.
import type { Channel } from "./preference.js";

export type NotificationStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

export interface Notification {
  id: string;
  alertId: string;
  /** Desnormalizado de `alerts.recipient_user_id` (modules.md §2 nota 15): escrito uma única vez
   * em `enqueueForAlert`, para que o job de envio decida SKIPPED (canal desativado, conta
   * suspensa, sem subscrição push) sem `notifications` ter de ler a tabela `alerts` — o que
   * fecharia um ciclo com `alerts -> notifications` (ver `notifications/README.md`). */
  recipientUserId: string;
  channel: Channel;
  status: NotificationStatus;
  attempts: number;
  nextAttemptAt?: Date;
  lastErrorCode?: string;
  sentAt?: Date;
  createdAt: Date;
}

/** ST6: backoff fixo entre tentativas de reenvio (1, 5, 15, 60, 240 min) — no máx. 5 retries
 * (6 envios no total, incluindo a primeira tentativa). */
export const RETRY_BACKOFF_MS: readonly number[] = [1, 5, 15, 60, 240].map((minutes) => minutes * 60_000);
export const MAX_RETRIES = RETRY_BACKOFF_MS.length;

export type RetryDecision = { terminal: true } | { terminal: false; nextAttemptAt: Date };

/**
 * Decide o que fazer depois de uma tentativa falhada: `attemptsAfterFailure` já inclui a
 * tentativa que acabou de falhar (1 = primeira tentativa falhou). `terminal: true` ⇒ esgotaram-se
 * as `MAX_RETRIES` repetições (ST6) — o estado fica `FAILED` sem `nextAttemptAt` (nunca mais
 * reprocessado pelo scanner, `infrastructure/repo.ts`).
 */
const LAST_BACKOFF_MS = RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 0;

export function decideRetry(attemptsAfterFailure: number, now: Date): RetryDecision {
  if (attemptsAfterFailure > MAX_RETRIES) {
    return { terminal: true };
  }
  const delayMs = RETRY_BACKOFF_MS[attemptsAfterFailure - 1] ?? LAST_BACKOFF_MS;
  return { terminal: false, nextAttemptAt: new Date(now.getTime() + delayMs) };
}
