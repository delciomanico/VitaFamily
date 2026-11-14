// openapi listInsurerServices / createInsurerService / updateInsurerService (UC-SEG-04, BR-SEG-22).
import { newId } from "../../../platform/ids/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { OpsActor } from "../domain/access.js";
import { parseServiceInput, parseServicePatch, parseServiceStatusFilter, type InsurerService } from "../domain/service.js";
import type { OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound, toPage, toPageQuery, type PageInput } from "./support.js";

export function createListServicesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listServices(actor: OpsActor, query: PageInput & { q?: string | undefined; status?: string | undefined }): Promise<Page<InsurerService>> {
    const page = toPageQuery(query);
    const status = parseServiceStatusFilter(query.status);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const rows = await deps.services.list(trx, actor.insurerId, { ...(query.q ? { q: query.q } : {}), ...(status ? { status } : {}) }, page);
      return toPage(rows, page, (s) => s);
    });
  };
}

export function createCreateServiceUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createService(actor: OpsActor, input: { code?: unknown; name?: unknown; category?: unknown }, context: RequestContext): Promise<InsurerService> {
    const parsed = parseServiceInput(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      // O código duplicado devolve `ConflictError` pela restrição única (também protege a corrida).
      const service = await deps.services.insert(trx, { id: newId(), insurerId: actor.insurerId, ...parsed, createdAt: deps.clock.now() });
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_SERVICE_CREATE", resourceType: "InsurerService", resourceId: service.id }));
      return service;
    });
  };
}

export function createUpdateServiceUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function updateService(actor: OpsActor, serviceId: string, input: { name?: unknown; category?: unknown; status?: unknown }, context: RequestContext): Promise<InsurerService> {
    const patch = parseServicePatch(input);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "admin");
      if (!(await deps.services.findById(trx, actor.insurerId, serviceId))) throw notFound();
      const service = await deps.services.update(trx, actor.insurerId, serviceId, patch, deps.clock.now());
      await deps.audit.record(
        trx,
        auditEvent(deps, actor, context, {
          action: "INSURER_SERVICE_UPDATE",
          resourceType: "InsurerService",
          resourceId: serviceId,
          ...(patch.status === undefined ? {} : { metadata: { status: patch.status } }),
        }),
      );
      return service;
    });
  };
}
