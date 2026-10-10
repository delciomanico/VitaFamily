// Job agendado `notifications.send` (pg-boss, modules.md §5) — só esta camada importa "pg-boss"
// (conventions.md §3.9). Mesmo padrão de `medications/infrastructure/jobs.ts`.
import type PgBoss from "pg-boss";

export const SEND_QUEUE = "notifications.send";

/** A cada minuto — mesma cadência do primeiro backoff (ST6: 1 min), para não atrasar o 1.º retry. */
const SEND_CRON = "* * * * *";

export async function registerSendWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.schedule(SEND_QUEUE, SEND_CRON, {});
  return boss.work(SEND_QUEUE, async () => {
    await handler();
  });
}
