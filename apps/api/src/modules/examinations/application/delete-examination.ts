// openapi.yaml `deleteExamination`: "Autorização: WRITE(EXAMS). Eliminar exame, resultados e
// documentos." FR-DOC-04/D15: documentos apagados ANTES do exame (mesmo critério de
// `prescriptions/application/delete-prescription.ts`, BR-RX-06); os resultados vão em cascata
// pelo FK (`exam_results.examination_id ON DELETE CASCADE`, schema.md §3).
import { NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { ActorIdentity, ExaminationsDeps, RequestContext } from "./ports.js";

export function createDeleteExaminationUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function deleteExamination(actor: ActorIdentity, familyId: string, memberId: string, examinationId: string, context: RequestContext): Promise<void> {
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "DELETE",
        subjectMemberId: memberId,
        category: "EXAMS",
      });

      const existing = await deps.examinationsRepo.findById(trx, familyId, memberId, examinationId);
      if (!existing) {
        throw new NotFoundError({ detail: "Exame não encontrado." });
      }

      await deps.documents.deleteAllForResource(trx, familyId, memberId, "EXAMINATION", examinationId);
      await deps.examinationsRepo.delete(trx, familyId, memberId, examinationId);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "EXAM_DELETE",
        resourceType: "Examination",
        resourceId: examinationId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
