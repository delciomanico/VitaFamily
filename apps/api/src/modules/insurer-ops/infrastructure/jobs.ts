// Job agendado de `insurer-ops` (pg-boss, modules.md §5) — só esta camada importa "pg-boss" (conventions.md §3.9).
// Mesmo padrão de `clinic-patients/infrastructure/jobs.ts`.
import type PgBoss from "pg-boss";

export const EXPIRE_POLICIES_QUEUE = "insurer.expire-policies";

/** Diário, logo após a meia-noite UTC (data de calendário `validTo < hoje`); idempotente. */
const DAILY_EXPIRE_CRON = "20 0 * * *";

export async function registerExpirePoliciesWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(EXPIRE_POLICIES_QUEUE);
  await boss.schedule(EXPIRE_POLICIES_QUEUE, DAILY_EXPIRE_CRON, {});
  return boss.work(EXPIRE_POLICIES_QUEUE, async () => {
    await handler();
  });
}

export const PURGE_IMPORT_PREVIEWS_QUEUE = "insurer.purge-import-previews";

/** Diário às 00:40 UTC; idempotente (só atua em lotes PREVIEW com mais de 24 h). */
const DAILY_PURGE_CRON = "40 0 * * *";

export async function registerPurgeImportPreviewsWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(PURGE_IMPORT_PREVIEWS_QUEUE);
  await boss.schedule(PURGE_IMPORT_PREVIEWS_QUEUE, DAILY_PURGE_CRON, {});
  return boss.work(PURGE_IMPORT_PREVIEWS_QUEUE, async () => {
    await handler();
  });
}
