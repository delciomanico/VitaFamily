// Estado da conta e dos termos, por pedido, com cache ≤60 s (authentication.md §1, ADR-007). O
// middleware HTTP (interface) usa isto para preencher `httpx`/`platform/actor` e aplicar o gate de
// termos (B6) fora das rotas isentas — essa decisão de isenção por rota não é feita aqui (não há
// acesso ao contrato OpenAPI nesta camada).
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { TtlCache } from "../domain/ttl-cache.js";
import type { AuthDeps } from "./ports.js";

export interface ActorState {
  userId: string;
  sessionId: string;
  platformAdmin: boolean;
  suspended: boolean;
  termsReacceptanceRequired: boolean;
}

interface CachedAccountState {
  platformAdmin: boolean;
  suspended: boolean;
  termsReacceptanceRequired: boolean;
}

export function createResolveActorStateUseCase<Trx>(
  deps: AuthDeps<Trx>,
  cache: TtlCache<CachedAccountState>,
) {
  return async function resolveActorState(userId: string, sessionId: string): Promise<ActorState> {
    let accountState = cache.get(userId);
    if (!accountState) {
      const user = await deps.usersPort.byId(deps.db, userId);
      if (!user) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      accountState = {
        platformAdmin: user.platformRole === "PLATFORM_ADMIN",
        suspended: user.status === "SUSPENDED",
        termsReacceptanceRequired: user.termsAcceptedVersion !== deps.currentTermsVersion,
      };
      cache.set(userId, accountState);
    }

    return { userId, sessionId, ...accountState };
  };
}
