// Ligação PostgreSQL (`pg`) + Kysely (query builder tipado, sem ORM/geração de código) e
// transações — só a `infrastructure` de cada módulo importa este ficheiro (conventions.md §1/§3.9).
import { AsyncLocalStorage } from "node:async_hooks";
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import pg, { Pool, type PoolConfig } from "pg";

/**
 * Colunas `date` (OID 1082) devolvem-se como texto `AAAA-MM-DD`, tal como os tipos das tabelas
 * (`string`) e o OpenAPI (`format: date`) declaram. Sem isto o `pg` constrói um `Date` no fuso do
 * processo (um dia a menos em fusos a leste de UTC) e o texto nunca chega às regras de negócio
 * (ex.: laudo de exame, `birthDate`). Regista-se uma só vez ao carregar o módulo.
 */
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

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

/** Semáforo FIFO (sem dependências) que limita as transações simultâneas de um `Kysely`. */
class Gate {
  private free: number;
  private readonly waiting: (() => void)[] = [];

  constructor(capacity: number) {
    this.free = capacity;
  }

  async acquire(): Promise<void> {
    if (this.free > 0) {
      this.free -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.free += 1;
  }
}

const transactionGates = new WeakMap<Kysely<Database>, Gate>();
/** Marca o contexto assíncrono que já ocupa um lugar do portão: as transações ANINHADAS (leituras de outros módulos) não esperam por ele. */
const insideGate = new AsyncLocalStorage<Gate>();

/** Cria a instância Kysely sobre o pool indicado. */
export function createDb(pool: Pool): Kysely<Database> {
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  // Com `max` ligações, no máximo `max - 1` transações EXTERNAS em simultâneo: sobra sempre uma ligação para as leituras feitas por
  // OUTRA ligação com a transação aberta (catálogos de outros módulos, que abrem a sua própria transação curta). Sem isto, `max`
  // transações a esperar cada uma por uma segunda ligação esgotariam o pool (impasse).
  const max = pool.options.max > 0 ? pool.options.max : 10;
  transactionGates.set(db, new Gate(Math.max(1, max - 1)));
  return db;
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
  const gate = transactionGates.get(db);
  if (!gate) return db.transaction().execute(fn);
  // Aninhada (chamada de dentro de uma transação já aberta): não ocupa lugar no portão, senão as externas esperariam por ela.
  if (insideGate.getStore() === gate) return db.transaction().execute(fn);
  await gate.acquire();
  try {
    return await insideGate.run(gate, () => db.transaction().execute(fn));
  } finally {
    gate.release();
  }
}
