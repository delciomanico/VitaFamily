// openapi createInsurerServiceKind (UC-SEG-18, BR-SEG-39): só INSURANCE_ADMIN; `code` único (CONFLICT); guia/despesa existentes nos catálogos.
import { newId } from "../../../platform/ids/index.js";
import type { OpsActor } from "../domain/access.js";
import { assertKnownTypes, parseServiceKindInput, type ServiceKind } from "../domain/service-kind.js";
import { ensureDefaultServiceKinds } from "./ensure-service-kinds.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize } from "./support.js";

export function createCreateServiceKindUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createServiceKind(actor: OpsActor, input: { code?: unknown; name?: unknown; guideType?: unknown; expenseType?: unknown }, context: RequestContext): Promise<ServiceKind> {
    const parsed = parseServiceKindInput(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      assertKnownTypes(await deps.catalogTypes.list(trx), parsed);
      await ensureDefaultServiceKinds(deps, trx, actor.insurerId);
      const kind = await deps.serviceKinds.insert(trx, { id: newId(), insurerId: actor.insurerId, ...parsed, createdAt: deps.clock.now() });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_SERVICE_KIND_CREATE", resourceType: "InsurerServiceKind", resourceId: kind.id }));
      return kind;
    });
  };
}
