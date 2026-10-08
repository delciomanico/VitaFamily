// Ator do pedido (equivalente a httpx.ActorInfo/httpx.Actor do ADR-012): quem faz o pedido.
// Preenchido pelo middleware de autenticação + pertença à família (M1/M3); o tipo e o mecanismo de
// transporte (AsyncLocalStorage) já existem em M0 para que M1 em diante só tenha de os preencher.
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Identifica quem faz o pedido. `familyId`/`memberId` são `undefined` fora de rotas com contexto
 * de família (ex.: `/users/me`, `/admin/*`). `sessionId` é o `sid` do access token (M1, módulo
 * `auth`) — usado por operações que precisam de distinguir a sessão atual das restantes (ex.:
 * `changePassword` revoga "as outras sessões", `logout` revoga só esta).
 */
export interface ActorInfo {
  userId: string;
  sessionId?: string;
  familyId?: string;
  memberId?: string;
  platformAdmin: boolean;
}

const actorStorage = new AsyncLocalStorage<ActorInfo>();

/**
 * Executa `fn` com `actor` disponível a `getActor()` durante toda a cadeia assíncrona (equivalente
 * a `httpx.WithActor`). Usado pelo middleware de autenticação para envolver o resto do pedido.
 */
export function runWithActor<T>(actor: ActorInfo, fn: () => T): T {
  return actorStorage.run(actor, fn);
}

/** Devolve o ator do pedido atual, ou `undefined` se o pedido não está autenticado. */
export function getActor(): ActorInfo | undefined {
  return actorStorage.getStore();
}
