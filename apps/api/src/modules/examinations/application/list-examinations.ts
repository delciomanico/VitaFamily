// openapi.yaml `listExaminations`: "Autorização: READ(EXAMS). Dependente com conta não vê (N2)."
import { parsePageParams } from "../../../platform/page/index.js";
import type { ExaminationStatus } from "../domain/examination.js";
import { buildExaminationView, type ExaminationView } from "./examination-view.js";
import type { ActorIdentity, CursorPage, ExaminationListFilter, ExaminationsDeps, RequestContext } from "./ports.js";
import { auditViewIfNotSelf } from "./support.js";

export interface ListExaminationsQuery {
  status?: string;
  from?: string;
  to?: string;
  limit?: string;
  cursor?: string;
}

function isExaminationStatus(value: string | undefined): value is ExaminationStatus {
  return value === "SCHEDULED" || value === "COMPLETED" || value === "CANCELLED";
}

export function createListExaminationsUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function listExaminations(actor: ActorIdentity, familyId: string, memberId: string, query: ListExaminationsQuery, context: RequestContext): Promise<CursorPage<ExaminationView>> {
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);

    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "EXAMS",
      });

      const filter: ExaminationListFilter = {
        ...(isExaminationStatus(query.status) ? { status: query.status } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
      };
      const page = await deps.examinationsRepo.listByMember(trx, familyId, memberId, filter, limit, cursor);
      const items = await Promise.all(page.items.map((examination) => buildExaminationView(deps, trx, examination)));
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, context });
      return { items, nextCursor: page.nextCursor };
    });
  };
}
