// openapi listAuthorizationRequests / getAuthorizationRequest (UC-SEG-06/08, BR-AUT-11, BR-INS-10): leituras só do prestador do
// pedido (a clínica do token); NÃO dependem do estado da ligação nem do módulo (os pedidos em curso mantêm-se visíveis). Sem auditoria.
import { ValidationError } from "../../../platform/errors/index.js";
import type { Page } from "../../../platform/page/index.js";
import { assertClinicRole, type ClinicOpsActor } from "../domain/access.js";
import type { AuthorizationListStatus } from "../domain/authorization.js";
import { AUTHORIZATION_STATUSES } from "../domain/authorization-machine.js";
import { requireUuid } from "../domain/validation.js";
import { toViews, type AuthorizationView } from "./authorization-support.js";
import { notFoundError } from "./beneficiary-lookup.js";
import type { OpsDeps } from "./ports.js";
import { toPage, toPageQuery, type PageInput } from "./support.js";

export interface ListAuthorizationsQuery extends PageInput {
  insurerId?: string | undefined;
  status?: string | undefined;
  processId?: string | undefined;
}

function parseStatus(value: string | undefined): AuthorizationListStatus | undefined {
  if (value === undefined) return undefined;
  const found = value === "OPEN" ? "OPEN" : AUTHORIZATION_STATUSES.find((status) => status === value);
  if (found === undefined) throw new ValidationError([{ field: "status", message: "valor inválido" }], { detail: "Filtro inválido." });
  return found;
}


export function createListAuthorizationsUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listAuthorizations(actor: ClinicOpsActor, query: ListAuthorizationsQuery): Promise<Page<AuthorizationView>> {
    assertClinicRole(actor.role);
    const page = toPageQuery(query);
    const status = parseStatus(query.status);
    const filter = {
      ...(query.insurerId !== undefined ? { insurerId: requireUuid(query.insurerId, "insurerId") } : {}),
      ...(query.processId !== undefined ? { processId: requireUuid(query.processId, "processId") } : {}),
      ...(status !== undefined ? { status } : {}),
    };
    return deps.withTransaction(async (trx) => {
      const rows = await deps.authorizations.listForClinic(trx, actor.clinicId, filter, page);
      // O repositório devolve `limit + 1` linhas: a sobra só serve para o cursor (toPage).
      return toPage(await toViews(deps, trx, rows, false), page, (view) => view);
    });
  };
}

export function createGetAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function getAuthorization(actor: ClinicOpsActor, authorizationId: string): Promise<AuthorizationView> {
    assertClinicRole(actor.role);
    return deps.withTransaction(async (trx) => {
      const row = await deps.authorizations.findForClinic(trx, actor.clinicId, authorizationId);
      if (!row) throw notFoundError();
      const [view] = await toViews(deps, trx, [row], true);
      if (!view) throw notFoundError();
      return view;
    });
  };
}
