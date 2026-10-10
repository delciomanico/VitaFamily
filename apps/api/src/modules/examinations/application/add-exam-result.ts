// openapi.yaml `addExamResult`: "Autorização: WRITE(EXAMS). D8, Q9, D11: sem interpretação nem
// alertas; só em exames COMPLETED." (endpoints.md) — ST5: resultados só se adicionam a exames
// COMPLETED (`INVALID_STATE_TRANSITION` se SCHEDULED/CANCELLED).
import { DomainError, NotFoundError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertHasValue, assertValidParameter, assertValidReferenceRange, type ExamResult } from "../domain/exam-result.js";
import type { ActorIdentity, ExaminationsDeps, NewExamResultRecord, RequestContext } from "./ports.js";

export interface AddExamResultInput {
  parameter: string;
  valueNumeric?: number | null;
  valueText?: string | null;
  unit?: string | null;
  referenceMin?: number | null;
  referenceMax?: number | null;
}

export function createAddExamResultUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function addExamResult(actor: ActorIdentity, familyId: string, memberId: string, examinationId: string, input: AddExamResultInput, context: RequestContext): Promise<ExamResult> {
    const parameter = assertValidParameter(input.parameter);
    assertHasValue(input.valueNumeric ?? undefined, input.valueText ?? undefined);
    assertValidReferenceRange(input.referenceMin ?? undefined, input.referenceMax ?? undefined);

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "CREATE",
        subjectMemberId: memberId,
        category: "EXAMS",
      });

      const examination = await deps.examinationsRepo.findById(trx, familyId, memberId, examinationId);
      if (!examination) {
        throw new NotFoundError({ detail: "Exame não encontrado." });
      }
      // ST5 (endpoints.md addExamResult): resultados só em exames COMPLETED.
      if (examination.status !== "COMPLETED") {
        throw new DomainError("INVALID_STATE_TRANSITION", { detail: "Resultados só podem ser adicionados a exames realizados." });
      }

      const now = deps.clock.now();
      const record: NewExamResultRecord = {
        id: newId(),
        examinationId,
        parameter,
        createdAt: now,
        ...(input.valueNumeric !== undefined && input.valueNumeric !== null ? { valueNumeric: input.valueNumeric } : {}),
        ...(input.valueText !== undefined && input.valueText !== null ? { valueText: input.valueText } : {}),
        ...(input.unit !== undefined && input.unit !== null ? { unit: input.unit } : {}),
        ...(input.referenceMin !== undefined && input.referenceMin !== null ? { referenceMin: input.referenceMin } : {}),
        ...(input.referenceMax !== undefined && input.referenceMax !== null ? { referenceMax: input.referenceMax } : {}),
      };
      const result = await deps.examResultsRepo.insert(trx, record);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "EXAM_RESULT_CREATE",
        resourceType: "ExamResult",
        resourceId: result.id,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return result;
    });
  };
}
