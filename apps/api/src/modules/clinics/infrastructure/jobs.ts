// Jobs agendados de `clinics` (pg-boss, modules.md §5) — só esta camada importa "pg-boss"
// (conventions.md §3.9). Mesmo padrão de `lifecycle/infrastructure/jobs.ts`.
import type PgBoss from "pg-boss";

export const GENERATE_SCHEDULE_QUEUE = "clinics.generate-schedule";

/** Diário (BR-CLN-12), de madrugada em UTC; idempotente, por isso repetir/atrasar é inofensivo. */
const DAILY_GENERATE_SCHEDULE_CRON = "10 2 * * *";

export async function registerGenerateScheduleWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  // `schedule` exige a queue já criada (FK pgboss.schedule -> pgboss.queue).
  await boss.createQueue(GENERATE_SCHEDULE_QUEUE);
  await boss.schedule(GENERATE_SCHEDULE_QUEUE, DAILY_GENERATE_SCHEDULE_CRON, {});
  return boss.work(GENERATE_SCHEDULE_QUEUE, async () => {
    await handler();
  });
}
