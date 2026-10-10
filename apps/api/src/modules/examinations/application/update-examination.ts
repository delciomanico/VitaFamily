// openapi.yaml `updateExamination`: "Autorização: WRITE(EXAMS)."
import { NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidExamDate, assertValidExaminationName } from "../domain/examination.js";
import { buildExaminationView, type ExaminationView } from "./examination-view.js";
import type { ActorIdentity, ExaminationChanges, ExaminationsDeps, RequestContext } from "./ports.js";
import { resolveClinicSnapshot } from "./support.js";

export interface UpdateExaminationInput {
  name?: string | null;
  examDate?: string | null;
  clinicId?: string | null;
  clinicName?: string | null;
  notes?: string | null;
}

export function createUpdateExaminationUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function updateExamination(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    examinationId: string,
    input: UpdateExaminationInput,
    context: RequestContext,
  ): Promise<ExaminationView> {
    if (input.name === null) {
      throw new ValidationError([{ field: "name", message: "obrigatório" }], { detail: "Nome não pode ser removido." });
    }
    if (input.examDate === null) {
      throw new ValidationError([{ field: "examDate", message: "obrigatório" }], { detail: "Data não pode ser removida." });
    }
    const name = input.name !== undefined ? assertValidExaminationName(input.name) : undefined;
    if (input.examDate) {
      assertValidExamDate(input.examDate);
    }

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

      const changes: ExaminationChanges = {
        ...(name !== undefined ? { name } : {}),
        ...(input.examDate ? { examDate: input.examDate } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      if (input.clinicId !== undefined || input.clinicName !== undefined) {
        const clinicSnapshot = await resolveClinicSnapshot(deps, trx, familyId, input.clinicId, input.clinicName);
        changes.clinicId = clinicSnapshot.clinicId ?? null;
        changes.clinicName = clinicSnapshot.clinicName ?? null;
      }

      const examination = await deps.examinationsRepo.update(trx, familyId, memberId, examinationId, changes);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: actor.userId,
        action: "EXAM_UPDATE",
        resourceType: "Examination",
        resourceId: examinationId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return buildExaminationView(deps, trx, examination);
    });
  };
}
