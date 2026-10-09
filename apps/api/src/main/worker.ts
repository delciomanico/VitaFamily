// Composition root do processo "worker": arranca a infraestrutura de filas (pg-boss) sobre o
// PostgreSQL (sem Redis, ADR-004/ADR-014) e regista os jobs de cada módulo (modules.md §4: só
// `documents` precisa de correr aqui em M5 — "antivírus"; cada módulo seguinte acrescenta 1 import
// + 1 registo, mesmo padrão).
import PgBoss from "pg-boss";
import { loadConfig } from "../platform/config/index.js";
import { createLogger } from "../platform/logger/index.js";
import { createDb, createPool } from "../platform/db/index.js";
import { SystemClock } from "../platform/clock/index.js";
import { MinioStorage } from "../platform/storage/index.js";
import { createAuditModule } from "../modules/audit/index.js";
import { ClamAvScanner, createDocumentsWorkerModule } from "../modules/documents/index.js";

export function main(): void {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });

  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const clock = new SystemClock();
  const audit = createAuditModule({ db });
  const storage = new MinioStorage({
    endpoint: config.S3_ENDPOINT,
    useSSL: config.S3_USE_SSL,
    accessKey: config.S3_ACCESS_KEY,
    secretKey: config.S3_SECRET_KEY,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET_DOCUMENTS,
  });
  const virusScanner = new ClamAvScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT });

  const boss = new PgBoss(config.DATABASE_URL);

  boss.on("error", (err: Error) => {
    logger.error({ err }, "pg_boss_error");
  });

  const documentsWorker = createDocumentsWorkerModule({ db, audit, clock, storage, virusScanner, boss });

  boss
    .start()
    .then(async () => {
      await documentsWorker.registerWorker();
      logger.info({}, "worker_started");
    })
    .catch((err: unknown) => {
      logger.error({ err }, "worker_start_failed");
      process.exit(1);
    });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "worker_shutting_down");
    await boss.stop();
    await pool.end();
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
