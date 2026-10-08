// UC-ACC-02: termina a sessão atual (revoga o refresh token; o cookie é limpo na interface).
import { auditContextFields } from "../../audit/index.js";
import type { AuthDeps, RequestContext } from "./ports.js";

export function createLogoutUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function logout(userId: string, sessionId: string, context: RequestContext): Promise<void> {
    const now = deps.clock.now();
    await deps.withTransaction(async (trx) => {
      await deps.sessionRepo.revoke(trx, sessionId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "AUTH_LOGOUT",
        resourceType: "Session",
        resourceId: sessionId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
