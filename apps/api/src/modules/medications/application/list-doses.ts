// openapi.yaml `listDoses`: "Autorização: READ(MEDICATION). FR-MED-05; filtros por período, estado
// e plano." Agenda do dia e histórico (UC-MED-03/08) partilham este endpoint.
import { parsePageParams } from "../../../platform/page/index.js";
import type { DoseOccurrence, DoseStatus } from "../domain/dose-occurrence.js";
import { auditViewIfNotSelf } from "./support.js";
import type { ActorIdentity, CursorPage, DoseListFilter, MedicationsDeps, RequestContext } from "./ports.js";

export interface ListDosesQuery {
  from?: string;
  to?: string;
  status?: string;
  planId?: string;
  limit?: string;
  cursor?: string;
}

const DOSE_STATUSES: readonly DoseStatus[] = ["PENDING", "TAKEN", "NOT_TAKEN", "UNCONFIRMED"];

function isDoseStatus(value: string | undefined): value is DoseStatus {
  return value !== undefined && DOSE_STATUSES.includes(value as DoseStatus);
}

export function createListDosesUseCase<Trx>(deps: MedicationsDeps<Trx>) {
  return async function listDoses(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    query: ListDosesQuery,
    context: RequestContext,
  ): Promise<CursorPage<DoseOccurrence>> {
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);
    const filter: DoseListFilter = {};
    if (query.from) filter.from = new Date(query.from);
    if (query.to) filter.to = new Date(query.to);
    if (isDoseStatus(query.status)) filter.status = query.status;
    if (query.planId) filter.planId = query.planId;

    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const page = await deps.dosesRepo.listByMember(trx, familyId, memberId, filter, limit, cursor);
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, resourceType: "DoseOccurrence", context });
      return page;
    });
  };
}
