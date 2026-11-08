// Job agendado de `clinic-patients` (pg-boss, modules.md §5) — só esta camada importa "pg-boss"
// (conventions.md §3.9). Mesmo padrão de `clinics/infrastructure/jobs.ts`.
import type PgBoss from "pg-boss";

export const PURGE_LINK_CODES_QUEUE = "clinic-patients.purge-link-codes";

/** Diário (BR-CLN-20), de madrugada em UTC; idempotente. */
const DAILY_PURGE_CRON = "40 3 * * *";

export async function registerPurgeLinkCodesWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(PURGE_LINK_CODES_QUEUE);
  await boss.schedule(PURGE_LINK_CODES_QUEUE, DAILY_PURGE_CRON, {});
  return boss.work(PURGE_LINK_CODES_QUEUE, async () => {
    await handler();
  });
}
