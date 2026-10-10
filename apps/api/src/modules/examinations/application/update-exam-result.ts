// openapi.yaml `updateExamResult`: "Autorização: WRITE(EXAMS)."
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidParameter, assertValidReferenceRange, type ExamResult } from "../domain/exam-result.js";
import type { ActorIdentity, ExamResultChanges, ExaminationsDeps, RequestContext } from "./ports.js";

export interface UpdateExamResultInput {
  parameter?: string | null;
  valueNumeric?: number | null;
  valueText?: string | null;
  unit?: string | null;
  referenceMin?: number | null;
  referenceMax?: number | null;
}

export function createUpdateExamResultUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function updateExamResult(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    examinationId: string,
    resultId: string,
    input: UpdateExamResultInput,
    context: RequestContext,
  ): Promise<ExamResult> {
    const parameter = input.parameter ? assertValidParameter(input.parameter) : undefined;

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "UPDATE",
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

      const nextValueNumeric = input.valueNumeric !== undefined ? (input.valueNumeric ?? undefined) : existing.valueNumeric;
      const nextValueText = input.valueText !== undefined ? (input.valueText ?? undefined) : existing.valueText;
      const nextReferenceMin = input.referenceMin !== undefined ? (input.referenceMin ?? undefined) : existing.referenceMin;
      const nextReferenceMax = input.referenceMax !== undefined ? (input.referenceMax ?? undefined) : existing.referenceMax;
      assertValidReferenceRange(nextReferenceMin, nextReferenceMax);
      if (nextValueNumeric === undefined && nextValueText === undefined) {
        throw new ValidationError([{ field: "valueNumeric", message: "indique um valor numérico ou texto" }], { detail: "Indique valor numérico ou texto." });
      }

      const changes: ExamResultChanges = {
        ...(parameter !== undefined ? { parameter } : {}),
        ...(input.valueNumeric !== undefined ? { valueNumeric: input.valueNumeric } : {}),
        ...(input.valueText !== undefined ? { valueText: input.valueText } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.referenceMin !== undefined ? { referenceMin: input.referenceMin } : {}),
        ...(input.referenceMax !== undefined ? { referenceMax: input.referenceMax } : {}),
      };
      const result = await deps.examResultsRepo.update(trx, examinationId, resultId, changes);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "EXAM_RESULT_UPDATE",
        resourceType: "ExamResult",
        resourceId: resultId,
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
