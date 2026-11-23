import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { MemberPageRead, ReadActor, ReadContext } from "../../../platform/reads/index.js";
import type { ApiObject } from "./ports.js";

/** Páginas lidas por secção (100 itens cada): relatórios são JSON agregados, não exportações. */
const MAX_PAGES = 5;
/** Tomas do Resumo (M17): um período de 5 anos tem muito mais ocorrências do que as outras listas. */
export const DOSE_MAX_PAGES = 200;

/**
 * BR-RPT-01: secção sem permissão é OMITIDA (nem se indica que está vazia). `Forbidden`/`NotFound`
 * do módulo dono significam "não posso ver"; qualquer outro erro é real e propaga-se.
 */
export async function readable<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return undefined;
    throw error;
  }
}

/** Percorre os cursores de uma listagem paginada. */
export async function readAll(
  read: MemberPageRead,
  actor: ReadActor,
  familyId: string,
  memberId: string,
  query: Record<string, string>,
  context: ReadContext,
  maxPages: number = MAX_PAGES,
): Promise<ApiObject[]> {
  const items: ApiObject[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result: Awaited<ReturnType<MemberPageRead>> = await read(actor, familyId, memberId, { ...query, limit: "100", ...(cursor ? { cursor } : {}) }, context);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return items;
}

export const str = (object: ApiObject, key: string): string => {
  const value = object[key];
  return typeof value === "string" ? value : "";
};

export const num = (object: ApiObject, key: string): number | null => {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export const list = (object: ApiObject, key: string): ApiObject[] => {
  const value = object[key];
  return Array.isArray(value) ? (value as ApiObject[]) : [];
};
