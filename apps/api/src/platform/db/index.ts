// Ligação PostgreSQL (`pg`) + Kysely (query builder tipado, sem ORM/geração de código) e
// transações — só a `infrastructure` de cada módulo importa este ficheiro (conventions.md §1/§3.9).
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import { Pool, type PoolConfig } from "pg";

/**
 * Tabelas da base de dados. Vazia em `platform` (nunca conhece módulos de negócio); cada módulo
 * acrescenta as suas tabelas por fusão de declaração, ex.:
 * ```ts
 * declare module "../../../platform/db/index.js" {
 *   interface Database {
 *     users: UsersTable;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- preenchida por módulos via fusão de declaração.
export interface Database {}

/** Cria o pool de ligações PostgreSQL. */
export function createPool(
  databaseUrl: string,
  config: Omit<PoolConfig, "connectionString"> = {},
): Pool {
  return new Pool({ connectionString: databaseUrl, ...config });
}

/** Cria a instância Kysely sobre o pool indicado. */
export function createDb(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Verifica a ligação real à BD (usado por `/health/ready`). */
export async function checkConnection(pool: Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Executa `fn` numa transação: commit se `fn` resolver, rollback caso contrário (ou em erro, que é
 * relançado). Usar em todos os casos de uso que escrevem mais de uma tabela (conventions.md §2).
 */
export async function withTransaction<T>(
  db: Kysely<Database>,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(fn);
}
