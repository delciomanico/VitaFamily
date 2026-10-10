// openapi.yaml `getExamination`: "Autorização: READ(EXAMS)."
import { NotFoundError } from "../../../platform/errors/index.js";
import { buildExaminationView, type ExaminationView } from "./examination-view.js";
import type { ActorIdentity, ExaminationsDeps, RequestContext } from "./ports.js";
import { auditViewIfNotSelf } from "./support.js";

export function createGetExaminationUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function getExamination(actor: ActorIdentity, familyId: string, memberId: string, examinationId: string, context: RequestContext): Promise<ExaminationView> {
    return deps.withTransaction(async (trx) => {
      const ctx = await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "READ",
        subjectMemberId: memberId,
        category: "EXAMS",
      });

      const examination = await deps.examinationsRepo.findById(trx, familyId, memberId, examinationId);
      if (!examination) {
        throw new NotFoundError({ detail: "Exame não encontrado." });
      }
      await auditViewIfNotSelf(deps, trx, ctx, { userId: actor.userId, familyId, memberId, context });
      return buildExaminationView(deps, trx, examination);
    });
  };
}
