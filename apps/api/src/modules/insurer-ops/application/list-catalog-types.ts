// openapi listInsurerCatalogTypes (UC-SEG-18, BR-SEG-39): catálogos globais para selects; leitura, qualquer papel do módulo; sem auditoria.
import type { OpsActor } from "../domain/access.js";
import type { CatalogTypes } from "../domain/service-kind.js";
import type { OpsDeps } from "./ports.js";
import { authorize } from "./support.js";

export function createListCatalogTypesUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listCatalogTypes(actor: OpsActor): Promise<CatalogTypes> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      return deps.catalogTypes.list(trx);
    });
  };
}
