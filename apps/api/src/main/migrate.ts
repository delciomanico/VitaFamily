// CLI "migrate": aplica db/migrations/*.sql (runner próprio) à base indicada por DATABASE_URL.
import { Pool } from "pg";
import { loadConfig } from "../platform/config/index.js";
import { createLogger } from "../platform/logger/index.js";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";

export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const pool = new Pool({ connectionString: config.DATABASE_URL });

  try {
    const results = await runMigrations(pool, defaultMigrationsDir());
    for (const result of results) {
      logger.info({ version: result.version, applied: result.applied }, "migration");
    }
    logger.info({ count: results.filter((r) => r.applied).length }, "migrate_done");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
