// openapi assignInsurerAuthorization (BR-AUT-18): atribuir (ou libertar) um pedido a um analista. É uma MARCA, não uma transição
// (sem evento de estado; auditada). O analista só toma para si um pedido normal `IN_REVIEW` livre; o supervisor atribui qualquer analista
// ativo ou liberta (`analystId: null`); os recursos não se atribuem.
import { ForbiddenError, ValidationError } from "../../../platform/errors/index.js";
import type { OpsActor } from "../domain/access.js";
import { checkAction } from "../domain/authorization-actions.js";
import { parseAssignInput } from "../domain/authorization-decision.js";
import { actionActor, assertActionAllowed, loadForDecision, reloadDetail, subjectOf } from "./insurer-authorization-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize } from "./support.js";

export function createAssignAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function assignAuthorization(actor: OpsActor, authorizationId: string, body: unknown, context: RequestContext) {
    const input = parseAssignInput(body);
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "authorizations-decide");
      const { row, appealDays, now } = await loadForDecision(deps, trx, actor, authorizationId);
      const isSupervisor = actor.role === "SUPERVISOR";

      let target: string | null;
      if (isSupervisor) {
        if (input.analystId === undefined) throw new ValidationError([{ field: "analystId", message: "indique o analista (ou null para libertar)" }], { detail: "Dados inválidos." });
        target = input.analystId;
      } else {
        // O analista só toma para si.
        if (input.analystId !== undefined && input.analystId !== actor.insuranceAccountId) throw new ForbiddenError({ detail: "Sem permissão para esta operação." });
        target = actor.insuranceAccountId;
      }

      assertActionAllowed(checkAction(target === null ? "UNASSIGN" : "ASSIGN", actionActor(actor), subjectOf(row, appealDays, now)));
      if (target !== null && isSupervisor && !(await deps.insurerAuthorizations.isActiveAnalyst(trx, actor.insurerId, target))) {
        throw new ValidationError([{ field: "analystId", message: "tem de ser um analista ativo da seguradora" }], { detail: "Dados inválidos." });
      }
      if (target !== null && target === row.priorRejecterAccountId) {
        throw new ValidationError([{ field: "analystId", message: "quem recusou o pedido antes não volta a decidi-lo" }], { detail: "Dados inválidos." });
      }
      await deps.insurerAuthorizations.assign(trx, actor.insurerId, row.id, target, now);
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "AUTHORIZATION_ASSIGN", resourceType: "AuthorizationRequest", resourceId: row.id, metadata: { assignedTo: target } }));
      return reloadDetail(deps, trx, actor, row.id, currency);
    });
  };
}
