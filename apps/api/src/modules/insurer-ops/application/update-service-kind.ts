// openapi updateInsurerServiceKind (UC-SEG-18, BR-SEG-39): nome, guia, despesa e estado; `code` imutável; inativar com serviços ATIVOS ligados ⇒ CONFLICT.
import type { OpsActor } from "../domain/access.js";
import { assertCanInactivate, assertKnownTypes, parseServiceKindPatch, type ServiceKind } from "../domain/service-kind.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound } from "./support.js";

export function createUpdateServiceKindUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function updateServiceKind(actor: OpsActor, kindId: string, input: { name?: unknown; guideType?: unknown; expenseType?: unknown; status?: unknown }, context: RequestContext): Promise<ServiceKind> {
    const patch = parseServiceKindPatch(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      const current = await deps.serviceKinds.findById(trx, actor.insurerId, kindId, true);
      if (!current) throw notFound();
      assertKnownTypes(await deps.catalogTypes.list(trx), patch);
      if (patch.status === "INACTIVE" && current.status === "ACTIVE") assertCanInactivate(await deps.serviceKinds.countActiveServices(trx, actor.insurerId, kindId));
      const kind = await deps.serviceKinds.update(trx, actor.insurerId, kindId, patch, deps.clock.now());
      await deps.audit.record(
        trx,
        auditEvent(deps, actor, context, { action: "INSURER_SERVICE_KIND_UPDATE", resourceType: "InsurerServiceKind", resourceId: kindId, ...(patch.status === undefined ? {} : { metadata: { status: patch.status } }) }),
      );
      return kind;
    });
  };
}
