// openapi listInsurerAuthorizations / getInsurerAuthorization (UC-SEG-07/20, BR-AUT-17..19): a fila da seguradora (ordenada por
// prazo, mais atrasado primeiro) e o detalhe para decidir. Leitura sem auditoria. `SUBMITTED` nunca aparece (transitório).
import { ValidationError } from "../../../platform/errors/index.js";
import { decodeCursor, encodeCursor, parsePageParams, type Page } from "../../../platform/page/index.js";
import type { OpsActor } from "../domain/access.js";
import type { AuthorizationDecider } from "../domain/authorization-actions.js";
import { AUTHORIZATION_STATUSES } from "../domain/authorization-machine.js";
import type { AssignedFilter, InsurerQueueFilter, QueueSort } from "../domain/insurer-authorization.js";
import { requireUuid } from "../domain/validation.js";
import { toInsurerDetail, toInsurerView, type InsurerAuthorizationDetailView, type InsurerAuthorizationView } from "./insurer-authorization-support.js";
import { POLICY_KEYS, policyValue } from "./authorization-support.js";
import { notFoundError } from "./beneficiary-lookup.js";
import type { OpsDeps } from "./ports.js";
import { authorize } from "./support.js";

export interface ListInsurerAuthorizationsQuery {
  status?: unknown;
  assigned?: unknown;
  overdue?: unknown;
  escalated?: unknown;
  appeal?: unknown;
  decidedBy?: unknown;
  sort?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

const invalid = (field: string): ValidationError => new ValidationError([{ field, message: "valor inválido" }], { detail: "Filtro inválido." });

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
  if (value === undefined) return fallback;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw invalid(field);
  return found;
}

function flag(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw invalid(field);
}

export function createListInsurerAuthorizationsUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function listInsurerAuthorizations(actor: OpsActor, query: ListInsurerAuthorizationsQuery): Promise<Page<InsurerAuthorizationView>> {
    const { limit, cursor } = parsePageParams(typeof query.limit === "string" || typeof query.limit === "number" ? String(query.limit) : undefined, typeof query.cursor === "string" ? query.cursor : undefined);
    const decoded = cursor === undefined ? undefined : decodeCursor(cursor);
    const decidedBy = query.decidedBy === undefined ? undefined : oneOf<AuthorizationDecider>(query.decidedBy, ["ANALYST", "SUPERVISOR", "SYSTEM"], "decidedBy", "ANALYST");
    const overdue = flag(query.overdue, "overdue");
    const escalated = flag(query.escalated, "escalated");
    const appeal = flag(query.appeal, "appeal");
    const now = deps.clock.now();
    const filter: InsurerQueueFilter = {
      status: oneOf(query.status, ["OPEN", ...AUTHORIZATION_STATUSES], "status", "OPEN"),
      assigned: oneOf<AssignedFilter>(query.assigned, ["ME", "UNASSIGNED", "ANY"], "assigned", "ANY"),
      sort: oneOf<QueueSort>(query.sort, ["DUE", "RECENT"], "sort", "DUE"),
      now,
      accountId: actor.insuranceAccountId,
      ...(overdue !== undefined ? { overdue } : {}),
      ...(escalated !== undefined ? { escalated } : {}),
      ...(appeal !== undefined ? { appeal } : {}),
      ...(decidedBy !== undefined ? { decidedBy } : {}),
    };
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "authorizations-read");
      const rows = await deps.insurerAuthorizations.list(trx, actor.insurerId, filter, { limit, ...(decoded ? { cursor: { at: decoded.createdAt, id: decoded.id } } : {}) });
      const appealDays = await policyValue(deps, trx, actor.insurerId, POLICY_KEYS.appealDays);
      const items = rows.slice(0, limit);
      const last = items[items.length - 1];
      const at = last === undefined ? null : filter.sort === "RECENT" ? last.updatedAt : last.decisionDueAt;
      return {
        items: items.map((row) => toInsurerView(row, actor, currency, appealDays, now)),
        nextCursor: rows.length > limit && last !== undefined && at !== null ? encodeCursor({ createdAt: at.toISOString(), id: last.id }) : null,
      };
    });
  };
}

export function createGetInsurerAuthorizationUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function getInsurerAuthorization(actor: OpsActor, authorizationId: string): Promise<InsurerAuthorizationDetailView> {
    requireUuid(authorizationId, "authorizationId");
    return deps.withTransaction(async (trx) => {
      const { currency } = await authorize(deps, trx, actor, "authorizations-read");
      const row = await deps.insurerAuthorizations.find(trx, actor.insurerId, authorizationId);
      if (!row) throw notFoundError();
      return toInsurerDetail(deps, trx, actor, row, currency);
    });
  };
}
