// `POST /clinic-portal/auth/logout` (endpoints.md "clinicLogout"): revoga o refresh token da
// sessão atual do portal (o cookie é limpo na interface).
import { auditContextFields } from "../../audit/index.js";
import type { ClinicsDeps, RequestContext } from "./ports.js";

export function createClinicLogoutUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function clinicLogout(clinicAccountId: string, sessionId: string, context: RequestContext): Promise<void> {
    const now = deps.clock.now();
    await deps.withTransaction(async (trx) => {
      await deps.clinicSessionRepo.revoke(trx, sessionId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: clinicAccountId,
        action: "CLINIC_ACCOUNT_LOGOUT",
        resourceType: "ClinicSession",
        resourceId: sessionId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
