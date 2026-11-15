// openapi rejectInsurerAuthorization (UC-SEG-07, BR-AUT-17/18): `IN_REVIEW → REJECTED`, motivo obrigatório e visível à clínica
// (administrativo; a UI avisa). Final para a clínica (recurso = novo pedido, BR-AUT-08); só o supervisor reabre (BR-AUT-22).
import type { OpsActor } from "../domain/access.js";
import { parseReasonInput } from "../domain/authorization-decision.js";
import { claimIfFreeAnalyst, decisionRole, loadForDecision, reloadDetail, requireAction } from "./insurer-authorization-support.js";
import { notifyFamily, recordTransition } from "./authorization-support.js";
import { conflictOnDecisionLost } from "./decision-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize } from "./support.js";

export function createRejectAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function rejectAuthorization(actor: OpsActor, authorizationId: string, body: unknown, context: RequestContext) {
    const { reason } = parseReasonInput(body);
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "authorizations-decide");
      const { row, appealDays, now } = await loadForDecision(deps, trx, actor, authorizationId);
      requireAction("REJECT", actor, row, appealDays, now);
      const decidedBy = decisionRole(actor);
      await claimIfFreeAnalyst(deps, trx, actor, row, now);
      if (!(await deps.insurerAuthorizations.decide(trx, actor.insurerId, row.id, "IN_REVIEW", { kind: "REJECT", note: reason, decidedBy, accountId: actor.insuranceAccountId, now }))) throw conflictOnDecisionLost();
      await recordTransition(deps, trx, { insurerId: actor.insurerId, authorizationId: row.id, from: "IN_REVIEW", to: "REJECTED", actor: decidedBy, actorAccountId: actor.insuranceAccountId, note: reason, now });
      await notifyFamily(deps, trx, { processId: row.processId, kind: "NOT_APPROVED", requestId: row.id, now });
      // O texto do motivo nunca vai à auditoria (BR-AUT-12).
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "AUTHORIZATION_REJECT", resourceType: "AuthorizationRequest", resourceId: row.id, metadata: { decidedBy } }));
      return reloadDetail(deps, trx, actor, row.id, currency);
    });
  };
}
