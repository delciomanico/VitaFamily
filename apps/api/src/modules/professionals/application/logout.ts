// `POST /professional-portal/auth/logout`: revoga a sessão atual (o cookie é limpo na interface).
import { auditContextFields } from "../../audit/index.js";
import type { ProfessionalsDeps, RequestContext } from "./ports.js";

export function createLogoutUseCase<Trx>(deps: ProfessionalsDeps<Trx>) {
  return async function logout(accountId: string, sessionId: string, context: RequestContext): Promise<void> {
    const now = deps.clock.now();
    await deps.withTransaction(async (trx) => {
      await deps.sessionRepo.revoke(trx, sessionId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "PROFESSIONAL_ACCOUNT",
        actorProfessionalAccountId: accountId,
        action: "PROFESSIONAL_LOGOUT",
        resourceType: "ProfessionalSession",
        resourceId: sessionId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
