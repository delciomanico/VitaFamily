import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { MemberPageRead } from "../../../platform/reads/index.js";
import type { ActorIdentity, ApiObject, RequestContext } from "./ports.js";

/** Teto de páginas por coleção (100 itens cada): um membro nunca chega perto disto no MVP. */
const MAX_PAGES = 100;

/** Secção sem permissão fica de fora do pacote (só se exporta o que o pedinte pode ler). */
export async function readable<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return undefined;
    throw error;
  }
}

export async function readAll(
  read: MemberPageRead,
  actor: ActorIdentity,
  familyId: string,
  memberId: string,
  context: RequestContext,
): Promise<ApiObject[]> {
  const items: ApiObject[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result: Awaited<ReturnType<MemberPageRead>> = await read(actor, familyId, memberId, { limit: "100", ...(cursor ? { cursor } : {}) }, context);
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

export const exportKey = (exportId: string) => `exports/${exportId}.zip`;
