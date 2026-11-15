// openapi reopenInsurerAuthorization (BR-AUT-22, ADR-035 §2): só o SUPERVISOR reabre uma recusa, `REJECTED → IN_REVIEW`, até
// `appealOpenUntil`, sem recurso vivo e sem pedido em curso igual (UNIQUE de BR-AUT-09 ⇒ 409). O `reason` é INTERNO (nunca visível à
// clínica). Limpa decisão, atribuição e escalada; recalcula o prazo; o pedido volta livre à fila; NÃO corre auto-aprovação.
import type { OpsActor } from "../domain/access.js";
import { parseReasonInput } from "../domain/authorization-decision.js";
import { loadForDecision, reloadDetail, requireAction } from "./insurer-authorization-support.js";
import { decisionDueAt, recordTransition } from "./authorization-support.js";
import { conflictOnDecisionLost } from "./decision-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize } from "./support.js";

export function createReopenAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function reopenAuthorization(actor: OpsActor, authorizationId: string, body: unknown, context: RequestContext) {
    const { reason } = parseReasonInput(body);
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "authorizations-decide");
      const { row, appealDays, now } = await loadForDecision(deps, trx, actor, authorizationId);
      requireAction("REOPEN", actor, row, appealDays, now);
      const due = await decisionDueAt(deps, trx, actor.insurerId, row.serviceId, now, row.parentRequestId !== null);
      // A violação do UNIQUE de duplicado em curso (outro pedido igual) sai como `ConflictError` do repositório.
      if (!(await deps.insurerAuthorizations.decide(trx, actor.insurerId, row.id, "REJECTED", { kind: "REOPEN", decisionDueAt: due, now }))) throw conflictOnDecisionLost();
      await recordTransition(deps, trx, { insurerId: actor.insurerId, authorizationId: row.id, from: "REJECTED", to: "IN_REVIEW", actor: "SUPERVISOR", actorAccountId: actor.insuranceAccountId, note: null, internalNote: reason, now });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "AUTHORIZATION_REOPEN", resourceType: "AuthorizationRequest", resourceId: row.id }));
      return reloadDetail(deps, trx, actor, row.id, currency);
    });
  };
}
