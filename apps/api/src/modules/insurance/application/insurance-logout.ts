// `POST /insurance-portal/auth/logout` (openapi insuranceLogout): revoga a sessão atual do portal
// (o cookie é limpo na interface).
import { auditContextFields } from "../../audit/index.js";
import type { InsuranceDeps, RequestContext } from "./ports.js";

export function createInsuranceLogoutUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function insuranceLogout(insuranceAccountId: string, sessionId: string, context: RequestContext): Promise<void> {
    const now = deps.clock.now();
    await deps.withTransaction(async (trx) => {
      await deps.insuranceSessionRepo.revoke(trx, sessionId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "INSURANCE_ACCOUNT",
        actorInsuranceAccountId: insuranceAccountId,
        action: "INSURANCE_ACCOUNT_LOGOUT",
        resourceType: "InsuranceSession",
        resourceId: sessionId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
