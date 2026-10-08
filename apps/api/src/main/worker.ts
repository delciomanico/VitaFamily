// Composition root do processo "worker": arranca a infraestrutura de filas (pg-boss) sobre o
// PostgreSQL (sem Redis, ADR-004/ADR-014). Ainda sem jobs registados (M0 é só a infraestrutura);
// cada módulo (M1+) regista os seus jobs aqui (1 import + 1 `boss.work(...)`).
import PgBoss from "pg-boss";
import { loadConfig } from "../platform/config/index.js";
import { createLogger } from "../platform/logger/index.js";

export function main(): void {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });

  const boss = new PgBoss(config.DATABASE_URL);

  boss.on("error", (err: Error) => {
    logger.error({ err }, "pg_boss_error");
  });

  boss
    .start()
    .then(() => {
      logger.info({}, "worker_started");
    })
    .catch((err: unknown) => {
      logger.error({ err }, "worker_start_failed");
      process.exit(1);
    });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "worker_shutting_down");
    await boss.stop();
    process.exit(0);
  }

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main();
