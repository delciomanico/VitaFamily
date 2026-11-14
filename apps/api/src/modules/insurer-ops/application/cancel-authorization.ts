// openapi cancelAuthorizationRequest (BR-AUT-15): `SUBMITTED|IN_REVIEW|INFO_REQUESTED → CANCELLED` com `closedReason=CLINIC_CANCELLED`.
// Cancelar um `APPROVED` fica para a fatia 4 (reserva de saldo): a máquina só o admite ao analista.
import { auditContextFields } from "../../audit/index.js";
import type { ClinicOpsActor } from "../domain/access.js";
import { parseCancelInput } from "../domain/authorization.js";
import { assertTransition, loadForWrite, recordTransition, toViews, type AuthorizationView } from "./authorization-support.js";
import type { OpsDeps, RequestContext } from "./ports.js";

export function createCancelAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function cancelAuthorization(actor: ClinicOpsActor, authorizationId: string, body: unknown, context: RequestContext): Promise<AuthorizationView> {
    const input = parseCancelInput(body);
    return deps.withTransaction(async (trx) => {
      const { row } = await loadForWrite(deps, trx, actor, authorizationId);
      assertTransition(row.status, "CANCELLED", "CLINIC", "CLINIC_CANCELLED");
      const now = deps.clock.now();
      await deps.authorizations.updateStatus(trx, row.insurerId, row.id, { status: "CANCELLED", closedReason: "CLINIC_CANCELLED", infoExpiresAt: null, now });
      await recordTransition(deps, trx, { insurerId: row.insurerId, authorizationId: row.id, from: row.status, to: "CANCELLED", actor: "CLINIC", actorAccountId: actor.clinicAccountId, note: input.note, closedReason: "CLINIC_CANCELLED", now });
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "CLINIC_ACCOUNT",
        actorClinicAccountId: actor.clinicAccountId,
        actorClinicId: actor.clinicId,
        action: "AUTHORIZATION_CANCEL",
        resourceType: "AuthorizationRequest",
        resourceId: row.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { insurerId: row.insurerId, from: row.status },
      });
      const updated = await deps.authorizations.findForClinic(trx, actor.clinicId, row.id);
      const [view] = await toViews(deps, trx, updated ? [updated] : [], true);
      if (!view) throw new Error("pedido inexistente logo após a escrita");
      return view;
    });
  };
}
