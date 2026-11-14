// openapi listInsurerServiceKinds (UC-SEG-18, BR-SEG-39): leitura; semeia os tipos por omissão na primeira utilização.
import type { OpsActor } from "../domain/access.js";
import { parseServiceStatusFilter } from "../domain/service.js";
import type { ServiceKind } from "../domain/service-kind.js";
import { ensureDefaultServiceKinds } from "./ensure-service-kinds.js";
import type { OpsDeps } from "./ports.js";
import { authorize } from "./support.js";

export function createListServiceKindsUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listServiceKinds(actor: OpsActor, query: { status?: string | undefined }): Promise<ServiceKind[]> {
    const status = parseServiceStatusFilter(query.status);
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      await ensureDefaultServiceKinds(deps, trx, actor.insurerId);
      return deps.serviceKinds.list(trx, actor.insurerId, status ? { status } : {});
    });
  };
}
