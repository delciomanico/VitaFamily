// openapi cancelInsurerAuthorization (BR-SEG-16, BR-AUT-21): reverter uma aprovação, `APPROVED → CANCELLED` com
// `closedReason=ANALYST_CANCELLED` (também quando é o supervisor). O analista só reverte decisões suas; a automática (`SYSTEM`) é só
// do supervisor. O `reason` é visível à clínica (guarda-se em `decisionNote`); o código deixa de valer.
import type { OpsActor } from "../domain/access.js";
import { parseReasonInput } from "../domain/authorization-decision.js";
import { decisionRole, loadForDecision, reloadDetail, requireAction } from "./insurer-authorization-support.js";
import { recordTransition } from "./authorization-support.js";
import { conflictOnDecisionLost } from "./decision-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize } from "./support.js";

export function createRevertAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function revertAuthorization(actor: OpsActor, authorizationId: string, body: unknown, context: RequestContext) {
    const { reason } = parseReasonInput(body);
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "authorizations-decide");
      const { row, appealDays, now } = await loadForDecision(deps, trx, actor, authorizationId);
      requireAction("CANCEL", actor, row, appealDays, now);
      if (!(await deps.insurerAuthorizations.decide(trx, actor.insurerId, row.id, "APPROVED", { kind: "REVERT", note: reason, now }))) throw conflictOnDecisionLost();
      await recordTransition(deps, trx, { insurerId: actor.insurerId, authorizationId: row.id, from: "APPROVED", to: "CANCELLED", actor: decisionRole(actor), actorAccountId: actor.insuranceAccountId, note: reason, closedReason: "ANALYST_CANCELLED", now });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "AUTHORIZATION_REVERT", resourceType: "AuthorizationRequest", resourceId: row.id, metadata: { previousDecidedBy: row.decidedByKind } }));
      return reloadDetail(deps, trx, actor, row.id, currency);
    });
  };
}
