// openapi.yaml `listPrescriptions`: "Autorização: READ(MEDICATION). Filtro por estado."
import { parsePageParams } from "../../../platform/page/index.js";
import type { PrescriptionStatus } from "../domain/prescription.js";
import { buildPrescriptionView, type PrescriptionView } from "./prescription-view.js";
import { auditViewIfNotSelf } from "./support.js";
import type { ActorIdentity, CursorPage, PrescriptionsDeps, RequestContext } from "./ports.js";

export interface ListPrescriptionsQuery {
  status?: string;
  limit?: string;
  cursor?: string;
}

function isPrescriptionStatus(value: string | undefined): value is PrescriptionStatus {
  return value === "ACTIVE" || value === "COMPLETED" || value === "CANCELLED";
}

export function createListPrescriptionsUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function listPrescriptions(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    query: ListPrescriptionsQuery,
    context: RequestContext,
  ): Promise<CursorPage<PrescriptionView>> {
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);

    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const page = await deps.prescriptionsRepo.listByMember(trx, familyId, memberId, isPrescriptionStatus(query.status) ? { status: query.status } : {}, limit, cursor);
      const items = await Promise.all(page.items.map((prescription) => buildPrescriptionView(deps, trx, prescription)));
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, context });
      return { items, nextCursor: page.nextCursor };
    });
  };
}
