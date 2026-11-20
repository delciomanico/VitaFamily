// Registo dos workers pg-boss de `record-sharing` — só esta camada importa "pg-boss" (conventions.md §3.9).
import type PgBoss from "pg-boss";
import { NOTIFY_PROFESSIONAL_QUEUE, type NotifyProfessionalJob } from "./jobs.js";

export const PURGE_EXPIRED_QUEUE = "record-sharing.purge-expired";
/** Diário às 04:05 UTC (modules.md §5, BR-MKT-76). */
export const PURGE_EXPIRED_CRON = "5 4 * * *";

export async function registerNotifyProfessionalWorker(boss: PgBoss, handler: (job: NotifyProfessionalJob) => Promise<unknown>): Promise<string> {
  await boss.createQueue(NOTIFY_PROFESSIONAL_QUEUE);
  return boss.work<NotifyProfessionalJob>(NOTIFY_PROFESSIONAL_QUEUE, async (jobs) => {
    for (const job of jobs) await handler(job.data);
  });
}

export async function registerPurgeExpiredWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  // `schedule` exige a fila criada (FK pgboss.schedule → pgboss.queue).
  await boss.createQueue(PURGE_EXPIRED_QUEUE);
  await boss.schedule(PURGE_EXPIRED_QUEUE, PURGE_EXPIRED_CRON, {});
  return boss.work(PURGE_EXPIRED_QUEUE, async () => {
    await handler();
  });
}
