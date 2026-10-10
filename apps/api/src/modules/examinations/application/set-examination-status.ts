// openapi.yaml `setExaminationStatus`: "Autorização: WRITE(EXAMS)."
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidExaminationTransition } from "../domain/examination.js";
import { buildExaminationView, type ExaminationView } from "./examination-view.js";
import type { ActorIdentity, ExaminationsDeps, ExaminationStatus, RequestContext } from "./ports.js";

export interface SetExaminationStatusInput {
  status: ExaminationStatus;
}

export function createSetExaminationStatusUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function setExaminationStatus(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    examinationId: string,
    input: SetExaminationStatusInput,
    context: RequestContext,
  ): Promise<ExaminationView> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "UPDATE",
        subjectMemberId: memberId,
        category: "EXAMS",
      });

      const existing = await deps.examinationsRepo.findById(trx, familyId, memberId, examinationId);
      if (!existing) {
        throw new NotFoundError({ detail: "Exame não encontrado." });
      }
      assertValidExaminationTransition(existing.status, input.status);

      const examination = await deps.examinationsRepo.updateStatus(trx, familyId, memberId, examinationId, input.status);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "EXAM_STATUS",
        resourceType: "Examination",
        resourceId: examinationId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
        metadata: { from: existing.status, to: input.status },
      });

      return buildExaminationView(deps, trx, examination);
    });
  };
}
