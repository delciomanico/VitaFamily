// Jobs agendados `medications.generate-doses`/`medications.mark-unconfirmed` (pg-boss, modules.md
// §5) — só esta camada importa "pg-boss" (conventions.md §3.9). Regista o agendamento (`schedule`)
// e o consumidor (`work`) no mesmo sítio: o processo "worker" (`main/worker.ts`) só chama
// `registerX()` uma vez por processo.
import type PgBoss from "pg-boss";

export const GENERATE_DOSES_QUEUE = "medications.generate-doses";
export const MARK_UNCONFIRMED_QUEUE = "medications.mark-unconfirmed";

/** Diário às 03:00 UTC (fora de horas de pico de qualquer fuso razoável) + "sob demanda" via `send`. */
const GENERATE_DOSES_CRON = "0 3 * * *";
/** A cada 5 min (modules.md §5: "medications.mark-unconfirmed | 5 min"). */
const MARK_UNCONFIRMED_CRON = "*/5 * * * *";

export async function registerGenerateDosesWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  // `schedule` exige a queue já criada (FK pgboss.schedule -> pgboss.queue) — `work` cria-a, mas só
  // depois de agendar seria tarde demais.
  await boss.createQueue(GENERATE_DOSES_QUEUE);
  await boss.schedule(GENERATE_DOSES_QUEUE, GENERATE_DOSES_CRON, {});
  return boss.work(GENERATE_DOSES_QUEUE, async () => {
    await handler();
  });
}

export async function registerMarkUnconfirmedWorker(boss: PgBoss, handler: () => Promise<unknown>): Promise<string> {
  await boss.createQueue(MARK_UNCONFIRMED_QUEUE);
  await boss.schedule(MARK_UNCONFIRMED_QUEUE, MARK_UNCONFIRMED_CRON, {});
  return boss.work(MARK_UNCONFIRMED_QUEUE, async () => {
    await handler();
  });
}
