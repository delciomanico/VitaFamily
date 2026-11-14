// Auxiliares comuns das implementações Kysely (violações de unicidade/FK ⇒ `ConflictError`, paginação keyset, LIKE seguro).
import { sql, type SelectQueryBuilder } from "kysely";
import { ConflictError } from "../../../platform/errors/index.js";
import type { PageQuery } from "../application/ports.js";

const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
export const INSERT_CHUNK = 500;

/** Corrida entre pedidos (unicidade/FK): `ConflictError`; qualquer outro erro segue como está. */
export async function guard<T>(fn: () => Promise<T>, detail: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === PG_UNIQUE_VIOLATION || code === PG_FOREIGN_KEY_VIOLATION) throw new ConflictError({ detail, cause: error });
    throw error;
  }
}

/** Paginação por conjunto de chaves (`created_at`, `id` descendentes); pede `limit + 1` linhas. */
export function keyset<DBS, TB extends keyof DBS, O>(query: SelectQueryBuilder<DBS, TB, O>, alias: string, page: PageQuery): SelectQueryBuilder<DBS, TB, O> {
  const createdAt = sql.ref(`${alias}.created_at`);
  const id = sql.ref(`${alias}.id`);
  let q = query;
  if (page.cursor) {
    q = q.where(sql<boolean>`(${createdAt}, ${id}) < (${new Date(page.cursor.createdAt)}::timestamptz, ${page.cursor.id}::uuid)`);
  }
  return q.orderBy(sql`${createdAt} desc`).orderBy(sql`${id} desc`).limit(page.limit + 1);
}

/** Linha acabada de escrever na mesma transação: a ausência é um erro de programação, não de negócio. */
export function required<T>(value: T | null): T {
  if (value === null) throw new Error("linha inexistente logo após a escrita");
  return value;
}

export const likeContains = (text: string): string => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

