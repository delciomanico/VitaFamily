// openapi listInsurerAuthorizationAssignees (BR-AUT-18): contas ATIVAS com papel AUTHORIZATION_ANALYST da própria seguradora (id e
// e-mail, nada mais) para o selector de «atribuir». SUPERVISOR e INSURANCE_ADMIN. Sem auditoria.
import type { OpsActor } from "../domain/access.js";
import type { AuthorizationAssignee, OpsDeps } from "./ports.js";
import { authorize } from "./support.js";

export function createListAuthorizationAssigneesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listAuthorizationAssignees(actor: OpsActor): Promise<AuthorizationAssignee[]> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "assignees");
      return deps.insurerAuthorizations.listAssignees(trx, actor.insurerId);
    });
  };
}
