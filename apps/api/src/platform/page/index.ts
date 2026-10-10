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

/**
 * Cursor opaco de paginação por conjunto de chaves ("keyset", `createdAt`+`id` — ordem estável
 * mesmo com `createdAt` repetido). Primeiro módulo a implementar paginação real de listas (M6,
 * `prescriptions`/`medications`); os módulos anteriores (M2-M5) ainda devolvem listas simples.
 * Base64url de JSON — opaco para o cliente (não é um id previsível), sem dependências novas.
 */
export interface KeysetCursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(value: KeysetCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): KeysetCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "createdAt" in parsed &&
      "id" in parsed &&
      typeof (parsed as Record<string, unknown>).createdAt === "string" &&
      typeof (parsed as Record<string, unknown>).id === "string"
    ) {
      return parsed as KeysetCursor;
    }
    throw new Error("forma inválida");
  } catch (cause) {
    throw new ValidationError([{ field: "cursor", message: "inválido" }], {
      detail: "Cursor de paginação inválido.",
      cause,
    });
  }
}
