import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { MemberPageRead, ReadActor, ReadContext } from "../../../platform/reads/index.js";
import type { ApiObject } from "./ports.js";

/** Páginas lidas por secção (100 itens cada): relatórios são JSON agregados, não exportações. */
const MAX_PAGES = 5;

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
): Promise<ApiObject[]> {
  const items: ApiObject[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
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
