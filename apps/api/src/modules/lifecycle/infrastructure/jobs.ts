// Jobs agendados de `lifecycle` (pg-boss, modules.md §5) — só esta camada importa "pg-boss"
// (conventions.md §3.9). Mesmo padrão de `medications/infrastructure/jobs.ts`.
import type PgBoss from "pg-boss";

export const COMING_OF_AGE_QUEUE = "lifecycle.coming-of-age";
export const BLOCKED_MEMBERS_QUEUE = "lifecycle.blocked-members";
export const EXPIRE_EXPORTS_QUEUE = "lifecycle.expire-exports";

const DAILY_COMING_OF_AGE_CRON = "0 3 * * *";
const DAILY_BLOCKED_CRON = "30 3 * * *";
const HOURLY_CRON = "15 * * * *";

async function register(boss: PgBoss, queue: string, cron: string, handler: () => Promise<unknown>): Promise<string> {
  // `schedule` exige a queue já criada (FK pgboss.schedule -> pgboss.queue).
  await boss.createQueue(queue);
  await boss.schedule(queue, cron, {});
  return boss.work(queue, async () => {
    await handler();
  });
}

export const registerComingOfAgeWorker = (boss: PgBoss, handler: () => Promise<unknown>) => register(boss, COMING_OF_AGE_QUEUE, DAILY_COMING_OF_AGE_CRON, handler);
export const registerBlockedMembersWorker = (boss: PgBoss, handler: () => Promise<unknown>) => register(boss, BLOCKED_MEMBERS_QUEUE, DAILY_BLOCKED_CRON, handler);
export const registerExpireExportsWorker = (boss: PgBoss, handler: () => Promise<unknown>) => register(boss, EXPIRE_EXPORTS_QUEUE, HOURLY_CRON, handler);
