// UC-PRC-03 `GET /families/{f}/members/{m}/processes` (BR-PRC-02/03/05/09/11, AC-PRC-03).
// Ordem fixa `openedAt` desc, `id` desc. O filtro `status` aplica-se DEPOIS da derivação: o servidor varre a BD
// em lotes (máx. 200 processos por pedido) e devolve até `limit` itens; se o varrimento esgota com menos itens
// e ainda há dados, `nextCursor` continua não nulo (o cliente segue-o até ser nulo).
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { decodeCursor, encodeCursor, parsePageParams, type KeysetCursor, type Page } from "../../../platform/page/index.js";
import { auditContextFields } from "../../audit/index.js";
import { deriveFamilyStatus } from "../domain/derive-family-status.js";
import { PROCESS_ORIGIN_TYPES, type FamilyStatus, type Process, type ProcessOriginType } from "../domain/process.js";
import type { ActorIdentity, ProcessesDeps, RequestContext } from "./ports.js";
import { loadProcessFacts } from "./load-facts.js";
import { readableFactsOf, toProcessView, type ProcessView } from "./process-view.js";
import { isAuditedReader, resolveReadAccess } from "./readable-categories.js";

/** Limite de varrimento por pedido (contrato: "máx. 200 processos por pedido"). */
export const MAX_SCAN = 200;
const MIN_BATCH = 25;
const FAMILY_STATUSES: readonly FamilyStatus[] = ["SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED"];

export interface ListProcessesQuery {
  status?: string;
  originType?: string;
  limit?: string;
  cursor?: string;
}

function parseEnum<T extends string>(value: string | undefined, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined) return undefined;
  const found = allowed.find((candidate) => candidate === value);
  if (!found) {
    throw new ValidationError([{ field, message: "valor inválido" }], { detail: "Filtro inválido." });
  }
  return found;
}

/** Cursor inválido é `MALFORMED_REQUEST` (contrato), não `VALIDATION_ERROR` como no resto da API. */
function parseCursor(cursor: string | undefined): KeysetCursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    return decodeCursor(cursor);
  } catch {
    throw new DomainError("MALFORMED_REQUEST", { detail: "Cursor de paginação inválido." });
  }
}

const keysetOf = (process: Process): KeysetCursor => ({ createdAt: process.openedAt.toISOString(), id: process.id });

export function createListProcessesUseCase<Trx>(deps: ProcessesDeps<Trx>) {
  return async function listProcesses(actor: ActorIdentity, familyId: string, memberId: string, query: ListProcessesQuery, context: RequestContext): Promise<Page<ProcessView>> {
    const { limit } = parsePageParams(query.limit);
    const status = parseEnum(query.status, FAMILY_STATUSES, "status");
    const originType = parseEnum<ProcessOriginType>(query.originType, PROCESS_ORIGIN_TYPES, "originType");
    let after = parseCursor(query.cursor);

    return deps.withTransaction(async (trx) => {
      const { readableOrigins, relation, coverageVisible } = await resolveReadAccess(deps, trx, actor, familyId, memberId);
      const originTypes = readableOrigins.filter((type) => originType === undefined || type === originType);
      if (originTypes.length === 0) {
        return { items: [], nextCursor: null };
      }

      const items: ProcessView[] = [];
      let last: Process | undefined;
      let hasMore = false;
      let remainingScan = MAX_SCAN;
      while (items.length < limit && remainingScan > 0) {
        const batchSize = Math.min(remainingScan, Math.max(limit, MIN_BATCH));
        const { rows, hasMore: more } = await deps.repo.listOfMember(trx, familyId, memberId, { originTypes, ...(after ? { after } : {}) }, batchSize);
        hasMore = more;
        if (rows.length === 0) break;

        const loaded = await loadProcessFacts(deps, trx, familyId, rows);
        for (const [index, process] of rows.entries()) {
          last = process;
          remainingScan--;
          const facts = readableFactsOf(process, loaded, coverageVisible);
          if (!facts) {
            deps.onInconsistency({ processId: process.id, originType: process.originType }); // BR-PRC-09: omite
          } else if (status === undefined || deriveFamilyStatus(facts).familyStatus === status) {
            items.push(toProcessView(process, facts));
          }
          if (items.length === limit) {
            hasMore = hasMore || index < rows.length - 1;
            break;
          }
        }
        if (last) after = keysetOf(last);
      }

      if (isAuditedReader(relation)) {
        await deps.audit.record(trx, {
          occurredAt: deps.clock.now(),
          actorType: "USER",
          actorUserId: actor.userId,
          action: "PROCESS_VIEW",
          resourceType: "Process",
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
          metadata: { count: items.length },
        });
      }

      return { items, nextCursor: hasMore && last ? encodeCursor(keysetOf(last)) : null };
    });
  };
}
