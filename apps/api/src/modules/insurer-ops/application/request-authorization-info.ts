// openapi requestInsurerAuthorizationInfo (UC-SEG-07, BR-AUT-14/18): `IN_REVIEW → INFO_REQUESTED`; `reason` visível à clínica;
// `infoExpiresAt` por INFO_REQUEST_EXPIRY_DAYS (política em dados); o analista fica com o pedido se estiver livre.
import type { OpsActor } from "../domain/access.js";
import { parseReasonInput } from "../domain/authorization-decision.js";
import { claimIfFreeAnalyst, decisionRole, loadForDecision, reloadDetail, requireAction } from "./insurer-authorization-support.js";
import { infoExpiresAt, notifyFamily, recordTransition } from "./authorization-support.js";
import { conflictOnDecisionLost } from "./decision-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize } from "./support.js";

export function createRequestAuthorizationInfoUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function requestAuthorizationInfo(actor: OpsActor, authorizationId: string, body: unknown, context: RequestContext) {
    const { reason } = parseReasonInput(body);
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "authorizations-decide");
      const { row, appealDays, now } = await loadForDecision(deps, trx, actor, authorizationId);
      requireAction("REQUEST_INFO", actor, row, appealDays, now);
      const by = decisionRole(actor);
      await claimIfFreeAnalyst(deps, trx, actor, row, now);
      const limit = await infoExpiresAt(deps, trx, actor.insurerId, now);
      if (!(await deps.insurerAuthorizations.decide(trx, actor.insurerId, row.id, "IN_REVIEW", { kind: "REQUEST_INFO", note: reason, infoExpiresAt: limit, accountId: actor.insuranceAccountId, now }))) throw conflictOnDecisionLost();
      await recordTransition(deps, trx, { insurerId: actor.insurerId, authorizationId: row.id, from: "IN_REVIEW", to: "INFO_REQUESTED", actor: by, actorAccountId: actor.insuranceAccountId, note: reason, now });
      await notifyFamily(deps, trx, { processId: row.processId, kind: "INFO_REQUESTED", requestId: row.id, now });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "AUTHORIZATION_REQUEST_INFO", resourceType: "AuthorizationRequest", resourceId: row.id }));
      return reloadDetail(deps, trx, actor, row.id, currency);
    });
  };
}
