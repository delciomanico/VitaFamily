// UC-PRC-04 `GET /families/{f}/members/{m}/processes/{processId}` (BR-PRC-05/09/11).
// Inexistente, de outro membro/família, de categoria não legível ou sem ato legível ⇒ `NOT_FOUND` (sem enumeração).
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, ProcessesDeps, RequestContext } from "./ports.js";
import { factOf, indexFacts, refOf, toProcessView, type ProcessView } from "./process-view.js";
import { isAuditedReader, resolveReadAccess } from "./readable-categories.js";

const notFound = () => new NotFoundError({ detail: "Processo não encontrado." });

export function createGetProcessUseCase<Trx>(deps: ProcessesDeps<Trx>) {
  return async function getProcess(actor: ActorIdentity, familyId: string, memberId: string, processId: string, context: RequestContext): Promise<ProcessView> {
    return deps.withTransaction(async (trx) => {
      const { readableOrigins, relation } = await resolveReadAccess(deps, trx, actor, familyId, memberId);

      const process = await deps.repo.findOfMember(trx, familyId, memberId, processId);
      if (!process || !readableOrigins.includes(process.originType)) {
        throw notFound();
      }
      const fact = factOf(indexFacts(await deps.facts.getActFacts(trx, familyId, [refOf(process)])), process);
      if (!fact) {
        deps.onInconsistency({ processId: process.id, originType: process.originType });
        throw notFound();
      }

      if (isAuditedReader(relation)) {
        await deps.audit.record(trx, {
          occurredAt: deps.clock.now(),
          actorType: "USER",
          actorUserId: actor.userId,
          action: "PROCESS_VIEW",
          resourceType: "Process",
          resourceId: process.id,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
        });
      }
      return toProcessView(process, fact);
    });
  };
}
