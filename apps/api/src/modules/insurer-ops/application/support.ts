// Utilitários comuns dos casos de uso do portal: autorização por papel/módulo, paginação e contexto de auditoria.
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { decodeCursor, encodeCursor, parsePageParams, type Page } from "../../../platform/page/index.js";
import { auditContextFields, type AuditEvent } from "../../audit/index.js";
import { assertModuleEnabled, assertOpsRole, type OpsAccess, type OpsActor } from "../domain/access.js";
import type { OpsDeps, PageQuery, RequestContext } from "./ports.js";

export const NOT_FOUND_DETAIL = "Recurso não encontrado.";

export function notFound(): NotFoundError {
  return new NotFoundError({ detail: NOT_FOUND_DETAIL });
}

/**
 * authorization.md §8.1/§8.2b: (1) módulo operacional desativado ⇒ `NOT_FOUND`; (2) papel (escrita só ADMIN/BENEFICIARY_MANAGER;
 * `INSURANCE_AGENT` ⇒ `FORBIDDEN`). O `insurerId` vem do token; as consultas filtram sempre por ele.
 */
export async function authorize<Trx>(deps: OpsDeps<Trx>, trx: Trx, actor: OpsActor, access: OpsAccess): Promise<{ currency: string }> {
  const settings = await deps.insurers.get(trx, actor.insurerId);
  assertModuleEnabled(settings?.operationalModuleEnabled === true);
  assertOpsRole(actor.role, access);
  return { currency: settings?.currency ?? "AOA" };
}

export interface PageInput {
  limit?: string | number | undefined;
  cursor?: string | undefined;
}

export function toPageQuery(input: PageInput): PageQuery {
  const { limit, cursor } = parsePageParams(input.limit === undefined ? undefined : String(input.limit), input.cursor);
  return { limit, ...(cursor === undefined ? {} : { cursor: decodeCursor(cursor) }) };
}

/** O repositório devolve até `limit + 1` linhas: a sobra só serve para saber se há mais páginas. */
export function toPage<T extends { id: string; createdAt: Date }, R>(rows: T[], page: PageQuery, map: (row: T) => R): Page<R> {
  const items = rows.slice(0, page.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > page.limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { items: items.map(map), nextCursor };
}

/** Evento de auditoria do portal (`actor_type=INSURANCE_ACCOUNT`; `metadata.insurerId` sempre, BR-SEG-15; nunca dados pessoais). */
export function auditEvent(
  deps: { clock: { now(): Date } },
  actor: OpsActor,
  context: RequestContext,
  event: Pick<AuditEvent, "action" | "resourceType" | "resourceId"> & { metadata?: Record<string, string | number | boolean | null> },
): AuditEvent {
  const { metadata, ...rest } = event;
  return {
    occurredAt: deps.clock.now(),
    actorType: "INSURANCE_ACCOUNT",
    actorInsuranceAccountId: actor.insuranceAccountId,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
    ...rest,
    metadata: { insurerId: actor.insurerId, ...metadata },
  };
}

/** Referência a recurso inexistente/de outra seguradora no corpo ou filtro (BR-SEG-14): `VALIDATION_ERROR`, nunca cruzamento. */
export function invalidReference(field: string, message: string): ValidationError {
  return new ValidationError([{ field, message }], { detail: "Dados inválidos." });
}
