// Paginação por cursor, partilhada por todos os endpoints de listagem (openapi.yaml: `limit`,
// `cursor`, resposta `{ items, nextCursor }`).
import { ValidationError } from "../errors/index.js";

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

/** Parâmetros de paginação já validados. */
export interface PageParams {
  limit: number;
  cursor?: string;
}

/** Página de resultados devolvida ao cliente. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Valida `limit`/`cursor` (query string, opcionais). `limit` fora de 1–100 é `VALIDATION_ERROR`
 * (campo `limit`).
 */
export function parsePageParams(limit?: string, cursor?: string): PageParams {
  const params: PageParams = { limit: DEFAULT_PAGE_LIMIT };
  if (limit !== undefined) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_LIMIT) {
      throw new ValidationError([{ field: "limit", message: "deve estar entre 1 e 100" }], {
        detail: "Limite inválido.",
      });
    }
    params.limit = n;
  }
  if (cursor !== undefined && cursor !== "") {
    params.cursor = cursor;
  }
  return params;
}
