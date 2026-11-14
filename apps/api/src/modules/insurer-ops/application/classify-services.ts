// openapi classifyInsurerServices (UC-SEG-18, BR-SEG-39): uma categoria → um tipo de serviço, numa transação; auditoria sem a categoria.
import type { OpsActor } from "../domain/access.js";
import { assertAssignable, parseClassifyRequest, selectServicesToClassify } from "../domain/service-kind.js";
import { ensureDefaultServiceKinds } from "./ensure-service-kinds.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize } from "./support.js";

export function createClassifyServicesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function classifyServices(actor: OpsActor, input: { category?: unknown; serviceKindId?: unknown; onlyUnclassified?: unknown }, context: RequestContext): Promise<{ updated: number }> {
    const request = parseClassifyRequest(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      await ensureDefaultServiceKinds(deps, trx, actor.insurerId);
      assertAssignable(await deps.serviceKinds.findById(trx, actor.insurerId, request.serviceKindId), "serviceKindId");
      const ids = selectServicesToClassify(await deps.services.listForClassification(trx, actor.insurerId), request);
      await deps.services.setServiceKind(trx, actor.insurerId, ids, request.serviceKindId, deps.clock.now());
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_SERVICE_CLASSIFY", resourceType: "InsurerServiceKind", resourceId: request.serviceKindId, metadata: { serviceKindId: request.serviceKindId, count: ids.length } }));
      return { updated: ids.length };
    });
  };
}
