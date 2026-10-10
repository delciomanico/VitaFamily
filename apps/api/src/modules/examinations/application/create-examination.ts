// openapi.yaml `createExamination`: "Autorização: WRITE(EXAMS). ST5: data passada nasce
// COMPLETED; futura nasce SCHEDULED com lembrete 24 h." (o lembrete é responsabilidade de
// `alerts`, M8 — ver `appointments/application/create-appointment.ts` para o mesmo critério.)
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidExamDate, assertValidExaminationName, deriveInitialExaminationStatus } from "../domain/examination.js";
import { buildExaminationView, type ExaminationView } from "./examination-view.js";
import type { ActorIdentity, ExaminationsDeps, NewExaminationRecord, RequestContext } from "./ports.js";
import { resolveClinicSnapshot } from "./support.js";

export interface CreateExaminationInput {
  name: string;
  examDate: string;
  clinicId?: string | null;
  clinicName?: string | null;
  notes?: string | null;
}

export function createCreateExaminationUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  return async function createExamination(actor: ActorIdentity, familyId: string, memberId: string, input: CreateExaminationInput, context: RequestContext): Promise<ExaminationView> {
    const name = assertValidExaminationName(input.name);
    assertValidExamDate(input.examDate);

    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "CREATE",
        subjectMemberId: memberId,
        category: "EXAMS",
      });

      const clinicSnapshot = await resolveClinicSnapshot(deps, trx, familyId, input.clinicId, input.clinicName);

      const now = deps.clock.now();
      const record: NewExaminationRecord = {
        id: newId(),
        familyId,
        memberId,
        name,
        examDate: input.examDate,
        status: deriveInitialExaminationStatus(input.examDate, now),
        createdAt: now,
        ...(input.notes ? { notes: input.notes } : {}),
        ...clinicSnapshot,
      };
      const examination = await deps.examinationsRepo.insert(trx, record);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "EXAM_CREATE",
        resourceType: "Examination",
        resourceId: examination.id,
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
