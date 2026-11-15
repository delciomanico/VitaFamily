// openapi respondAuthorizationInfo (UC-SEG-08, BR-AUT-14): a clínica responde a «falta informação»: `INFO_REQUESTED → IN_REVIEW`, novo
// `decisionDueAt` e `infoExpiresAt` limpo. A mensagem é administrativa e nunca vai à auditoria nem aos logs (BR-AUT-12).
import { auditContextFields } from "../../audit/index.js";
import type { ClinicOpsActor } from "../domain/access.js";
import { parseRespondInput } from "../domain/authorization.js";
import { assertTransition, decisionDueAt, loadForWrite, recordTransition, toViews, type AuthorizationView } from "./authorization-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";

export function createRespondAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function respondAuthorization(actor: ClinicOpsActor, authorizationId: string, body: unknown, context: RequestContext): Promise<AuthorizationView> {
    const input = parseRespondInput(body);
    return deps.withTransaction(async (trx) => {
      const { row } = await loadForWrite(deps, trx, actor, authorizationId);
      assertTransition(row.status, "IN_REVIEW", "CLINIC");
      const now = deps.clock.now();
      await deps.authorizations.updateStatus(trx, row.insurerId, row.id, { status: "IN_REVIEW", closedReason: null, infoExpiresAt: null, decisionDueAt: await decisionDueAt(deps, trx, row.insurerId, row.serviceId, now, row.parentRequestId !== null), now });
      await recordTransition(deps, trx, { insurerId: row.insurerId, authorizationId: row.id, from: row.status, to: "IN_REVIEW", actor: "CLINIC", actorAccountId: actor.clinicAccountId, note: input.message, now });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        actorClinicId: actor.clinicId,
        action: "AUTHORIZATION_INFO_RESPOND",
        resourceType: "AuthorizationRequest",
        resourceId: row.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { insurerId: row.insurerId },
      });
      const updated = await deps.authorizations.findForClinic(trx, actor.clinicId, row.id);
      const [view] = await toViews(deps, trx, updated ? [updated] : [], true);
      if (!view) throw new Error("pedido inexistente logo após a escrita");
      return view;
    });
  };
}
