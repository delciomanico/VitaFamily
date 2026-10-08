// Runner mínimo próprio de migrações (ADR-014: substitui goose, sem Prisma/node-pg-migrate).
// Tabela de controlo (`schema_migrations`) + cada ficheiro numa transação; idempotente (não
// reaplica o que já está registado). Aplica `db/migrations/*.sql` em ordem numérica (nome do
// ficheiro, zero-padded).
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export interface MigrationResult {
  version: string;
  applied: boolean;
}

const GOOSE_UP = /^--\s*\+goose\s+Up/i;
const GOOSE_DOWN = /^--\s*\+goose\s+Down/i;

/**
 * Extrai só a parte "Up" de uma migração. Migrações reaproveitadas de ADR-012 trazem marcadores
 * `-- +goose Up` / `-- +goose Down` (texto, não é uma dependência do goose); migrações novas,
 * escritas em SQL simples sem marcadores, são executadas na íntegra.
 */
export function extractUpSql(content: string): string {
  const lines = content.split(/\r?\n/);
  const hasMarkers = lines.some((line) => GOOSE_UP.test(line.trim()));
  if (!hasMarkers) {
    return content;
  }
  const out: string[] = [];
  let capturing = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (GOOSE_UP.test(trimmed)) {
      capturing = true;
      continue;
    }
    if (GOOSE_DOWN.test(trimmed)) {
      capturing = false;
      continue;
    }
    if (capturing) {
      out.push(line);
    }
  }
  return out.join("\n");
}

async function ensureControlTable(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

/** Aplica, em ordem, as migrações de `migrationsDir` ainda não registadas em `schema_migrations`. */
export async function runMigrations(pool: Pool, migrationsDir: string): Promise<MigrationResult[]> {
  await ensureControlTable(pool);

  const appliedRows = await pool.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  const applied = new Set(appliedRows.rows.map((row) => row.version));

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const results: MigrationResult[] = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) {
      results.push({ version, applied: false });
      continue;
    }

    const content = await readFile(join(migrationsDir, file), "utf8");
    const upSql = extractUpSql(content);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(upSql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      results.push({ version, applied: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migrate: falha ao aplicar ${file}`, { cause: err });
    } finally {
      client.release();
    }
  }

  return results;
}

/** Diretório `db/migrations` relativo a este ficheiro (funciona em `src` e em `dist`). */
export function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "migrations");
}
