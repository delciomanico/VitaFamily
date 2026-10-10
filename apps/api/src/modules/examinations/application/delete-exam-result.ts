// openapi.yaml `deleteExamResult`: "Autorização: WRITE(EXAMS)."
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, ExaminationsDeps, RequestContext } from "./ports.js";

export function createDeleteExamResultUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function deleteExamResult(actor: ActorIdentity, familyId: string, memberId: string, examinationId: string, resultId: string, context: RequestContext): Promise<void> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "DELETE",
        subjectMemberId: memberId,
        category: "EXAMS",
      });

      const examination = await deps.examinationsRepo.findById(trx, familyId, memberId, examinationId);
      if (!examination) {
        throw new NotFoundError({ detail: "Exame não encontrado." });
      }
      const existing = await deps.examResultsRepo.findById(trx, examinationId, resultId);
      if (!existing) {
        throw new NotFoundError({ detail: "Resultado não encontrado." });
      }

      await deps.examResultsRepo.delete(trx, examinationId, resultId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "EXAM_RESULT_DELETE",
        resourceType: "ExamResult",
        resourceId: resultId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
