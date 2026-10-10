// Job agendado `alerts.scan` (pg-boss, modules.md §5: "1 min") — só esta camada importa
// "pg-boss" (conventions.md §3.9). Mesmo padrão de `medications/infrastructure/jobs.ts`.
import type PgBoss from "pg-boss";

export const SCAN_QUEUE = "alerts.scan";

/** NFR-PERF-03 (≤ 1 min de latência, ADR-009 "Consequências"). */
const SCAN_CRON = "* * * * *";

export async function registerScanWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  // `schedule` exige a queue já criada (FK pgboss.schedule -> pgboss.queue) — `work` cria-a, mas só
  // depois de agendar seria tarde demais.
  await boss.createQueue(SCAN_QUEUE);
  await boss.schedule(SCAN_QUEUE, SCAN_CRON, {});
  return boss.work(SCAN_QUEUE, async () => {
    await handler();
  });
}
