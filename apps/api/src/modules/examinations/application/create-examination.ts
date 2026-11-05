// openapi.yaml `createExamination`: "Autorização: WRITE(EXAMS). ST5: data passada nasce
// COMPLETED; futura nasce SCHEDULED com lembrete 24 h; com `slotId` (ADR-023 revisto, BR-APT-11) a
// marcação é direta e nasce SCHEDULED se o horário tem vaga." (o lembrete é responsabilidade de
// `alerts`, M8 — ver `appointments/application/create-appointment.ts` para o mesmo critério.)
import { ConflictError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidExamDate, assertValidExaminationName, deriveInitialExaminationStatus, localExamDate } from "../domain/examination.js";
import { buildExaminationView, type ExaminationView } from "./examination-view.js";
import type { ActorIdentity, ExaminationsDeps, NewExaminationRecord, RequestContext } from "./ports.js";
import { resolveClinicSnapshot } from "./support.js";

export interface CreateExaminationInput {
  name: string;
  examDate: string;
  clinicId?: string | null;
  clinicName?: string | null;
  /** UC-EXM-08 (BR-EXM-05/BR-APT-11): marcação direta num horário `EXAM` de clínica parceira. Incompatível com
   * `clinicId`/`clinicName`; `name`/`examDate`/clínica passam a ser os do horário (congelados). */
  slotId?: string | null;
  notes?: string | null;
}

export function createCreateExaminationUseCase<Trx>(deps: ExaminationsDeps<Trx>) {
  /**
   * UC-EXM-08/AC-EXM-03 (BR-EXM-05, BR-APT-11): marcação DIRETA — o exame nasce `SCHEDULED` com tipo
   * (`name`), data e clínica congelados do horário. Concorrência: a transação bloqueia a linha do
   * horário (`SELECT … FOR UPDATE`), valida `kind=EXAM` (senão `VALIDATION_ERROR`), futuro/existente
   * (senão `CONFLICT`), conta os `SCHEDULED` e só insere se `count < capacity` (senão `CONFLICT`);
   * o `COMMIT` liberta o bloqueio. O mesmo membro não ocupa duas vagas do mesmo horário (`CONFLICT`).
   */
  async function bookExamInSlot(actor: ActorIdentity, familyId: string, memberId: string, slotId: string, input: CreateExaminationInput, context: RequestContext): Promise<ExaminationView> {
    if (input.clinicId || input.clinicName) {
      throw new ValidationError([{ field: "slotId", message: "incompatível com clinicId/clinicName" }], { detail: "Com horário, a clínica é a do próprio horário." });
    }
    return deps.withTransaction(async (trx) => {
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "CREATE",
        subjectMemberId: memberId,
        category: "EXAMS",
      });

      const slot = await deps.clinics.lockSlot(trx, slotId);
      if (!slot) {
        throw new ConflictError({ detail: "Esse horário já não está disponível." });
      }
      if (slot.kind !== "EXAM") {
        throw new ValidationError([{ field: "slotId", message: "horário de consulta; use o pedido de consulta" }], { detail: "Horário inválido para exame." });
      }
      const clinic = await deps.clinics.getBookableClinic(trx, familyId, slot.clinicId);
      if (!clinic) {
        throw new ValidationError([{ field: "slotId", message: "clínica inválida ou arquivada" }], { detail: "Clínica inválida." });
      }
      const now = deps.clock.now();
      if (slot.startsAt.getTime() <= now.getTime()) {
        throw new ConflictError({ detail: "Esse horário já passou." });
      }
      if (await deps.examinationsRepo.existsScheduledForMember(trx, slot.id, memberId)) {
        throw new ConflictError({ detail: "Este membro já tem uma marcação nesse horário." });
      }
      const booked = (await deps.examinationsRepo.countScheduledBySlot(trx, [slot.id]))[0]?.count ?? 0;
      if (booked >= slot.capacity) {
        throw new ConflictError({ detail: "Esse horário já não tem vagas." });
      }

      const examination = await deps.examinationsRepo.insert(trx, {
        id: newId(),
        familyId,
        memberId,
        name: slot.specialty,
        examDate: localExamDate(slot.startsAt),
        status: "SCHEDULED",
        clinicId: clinic.id,
        clinicName: clinic.name,
        slotId: slot.id,
        scheduledAt: slot.startsAt,
        createdAt: now,
        ...(input.notes ? { notes: input.notes } : {}),
      });

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
        metadata: { slotId: slot.id },
      });

      return buildExaminationView(deps, trx, examination);
    });
  }

  return async function createExamination(actor: ActorIdentity, familyId: string, memberId: string, input: CreateExaminationInput, context: RequestContext): Promise<ExaminationView> {
    if (input.slotId) {
      return bookExamInSlot(actor, familyId, memberId, input.slotId, input, context);
    }
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
