// Raiz do módulo `examinations` (ADR-015/conventions.md §1): única API pública importável por
// outros módulos (`alerts`, `reports` — M8+, modules.md §2) e pelo composition root
// (`main/api.ts`). M7 (plan.md §4): Examination e ExamResult (FR-EXM). Depende de `access`,
// `clinics` (`ClinicLookup`), `documents` (documentos do exame, FR-DOC-04) e `audit`.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { MemberPageRead } from "../../platform/reads/index.js";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import type { ClinicsModule } from "../clinics/index.js";
import type { DocumentsModule } from "../documents/index.js";
import {
  createCancelClinicExaminationUseCase,
  createCompleteClinicExaminationUseCase,
  createDeleteClinicExamDocumentUseCase,
  createListClinicExamAgendaUseCase,
  createUploadClinicExamDocumentUseCase,
} from "./application/clinic-examinations.js";
import { createAddExamResultUseCase } from "./application/add-exam-result.js";
import { createCreateExaminationUseCase } from "./application/create-examination.js";
import { createDeleteExaminationUseCase } from "./application/delete-examination.js";
import { createDeleteExamResultUseCase } from "./application/delete-exam-result.js";
import { createExamResultHistoryUseCase } from "./application/exam-result-history.js";
import { createGetExaminationUseCase } from "./application/get-examination.js";
import { createListExaminationsUseCase } from "./application/list-examinations.js";
import type { ExaminationsDeps, ExamAlertsPort } from "./application/ports.js";
import { createSetExaminationStatusUseCase } from "./application/set-examination-status.js";
import { createUpdateExaminationUseCase } from "./application/update-examination.js";
import { createUpdateExamResultUseCase } from "./application/update-exam-result.js";
import { KyselyExamResultsRepository, KyselyExaminationsRepository } from "./infrastructure/repo.js";
import { toExaminationPage } from "./interface/dto.js";
import { createExaminationsClinicPortalRouter, type ExaminationsClinicPortalController } from "./interface/clinic-portal-router.js";
import { createExaminationsRouter, type ExaminationsController } from "./interface/router.js";

import type { Examination } from "./domain/examination.js";

export type { Examination, ExaminationIssuer, ExaminationStatus } from "./domain/examination.js";
export type { ExamResult } from "./domain/exam-result.js";

export interface ExaminationsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clinics: ClinicsModule;
  documents: DocumentsModule;
  /** D19: alertas de evento de exame — ligado no composition root à API pública de `alerts`
   * (`alerts` depende de `examinations`, nunca o inverso; ver `ExamAlertsPort`). */
  alerts: ExamAlertsPort<Kysely<Database>>;
  clock: Clock;
}

/** Facto mínimo de uma origem de recomendação (modules.md §3 nota 22): nunca o registo completo. */
export interface ClinicExamOrigin {
  familyId: string;
  memberId: string;
  status: string;
  clinicName?: string;
}

export interface ExaminationsModule {
  router: Router;
  /** `/clinic-portal/exam-*` (D19) — ver `interface/clinic-portal-router.ts` para a decisão de onde vive. */
  clinicPortalRouter: Router;
  /** BR-APT-11 (`appointments.listAvailableSlots` kind=EXAM e `clinics` `ClinicSlotView`): exames `SCHEDULED` por horário. */
  countScheduledBySlot: (trx: Kysely<Database>, slotIds: string[]) => Promise<{ slotId: string; count: number }[]>;
  /** BR-CLN-08: porta de libertação dos PDF da clínica para `documents` (exame `COMPLETED`). */
  releaseGate: { isReleased: (trx: Kysely<Database>, document: { familyId: string; memberId: string; resourceId: string }) => Promise<boolean> };
  /** BR-CLN-09 (`recommendations`, ligado no composition root): "este exame pertence à clínica X e está no estado Y". */
  findClinicOrigin: (trx: Kysely<Database>, clinicId: string, examinationId: string) => Promise<ClinicExamOrigin | null>;
  /** Leituras para `reports` (mesma autorização e auditoria dos endpoints GET). */
  reads: { examinations: MemberPageRead };
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createExaminationsModule(deps: ExaminationsModuleDeps): ExaminationsModule {
  const examinationsRepo = new KyselyExaminationsRepository();
  const examResultsRepo = new KyselyExamResultsRepository();

  const examinationsDeps: ExaminationsDeps<Kysely<Database>> = {
    examinationsRepo,
    examResultsRepo,
    policy: deps.access.policy,
    memberNames: { getMemberName: deps.access.getMemberName },
    alerts: deps.alerts,
    clinics: { getBookableClinic: deps.clinics.getBookableClinic, lockSlot: deps.clinics.lockClinicSlot },
    documents: {
      listForResource: deps.documents.listForResource,
      deleteAllForResource: deps.documents.deleteAllForResource,
      uploadClinicExamDocument: deps.documents.uploadClinicExamDocument,
      deleteClinicExamDocument: deps.documents.deleteClinicExamDocument,
    },
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const controller: ExaminationsController = {
    listExaminations: createListExaminationsUseCase(examinationsDeps),
    createExamination: createCreateExaminationUseCase(examinationsDeps),
    getExamination: createGetExaminationUseCase(examinationsDeps),
    updateExamination: createUpdateExaminationUseCase(examinationsDeps),
    deleteExamination: createDeleteExaminationUseCase(examinationsDeps),
    setExaminationStatus: createSetExaminationStatusUseCase(examinationsDeps),
    addExamResult: createAddExamResultUseCase(examinationsDeps),
    updateExamResult: createUpdateExamResultUseCase(examinationsDeps),
    deleteExamResult: createDeleteExamResultUseCase(examinationsDeps),
    examResultHistory: createExamResultHistoryUseCase(examinationsDeps),
  };

  const clinicPortalController: ExaminationsClinicPortalController = {
    listClinicExamAgenda: createListClinicExamAgendaUseCase(examinationsDeps),
    cancelClinicExamination: createCancelClinicExaminationUseCase(examinationsDeps),
    completeClinicExamination: createCompleteClinicExaminationUseCase(examinationsDeps),
    uploadClinicExamDocument: createUploadClinicExamDocumentUseCase(examinationsDeps),
    deleteClinicExamDocument: createDeleteClinicExamDocumentUseCase(examinationsDeps),
  };

  return {
    router: createExaminationsRouter(controller),
    clinicPortalRouter: createExaminationsClinicPortalRouter(clinicPortalController),
    countScheduledBySlot: (trx, slotIds) => examinationsRepo.countScheduledBySlot(trx, slotIds),
    findClinicOrigin: async (trx, clinicId, examinationId) => {
      const examination = await examinationsRepo.findByClinicId(trx, clinicId, examinationId);
      return examination
        ? { familyId: examination.familyId, memberId: examination.memberId, status: examination.status, ...(examination.clinicName ? { clinicName: examination.clinicName } : {}) }
        : null;
    },
    releaseGate: {
      isReleased: (trx, document) => examinationsRepo.isCompleted(trx, document.familyId, document.memberId, document.resourceId),
    },
    reads: {
      examinations: async (actor, familyId, memberId, query, context) => toExaminationPage(await controller.listExaminations(actor, familyId, memberId, query, context)),
    },
  };
}

export interface ExaminationsReminderQueries {
  listReminderCandidates: (trx: Kysely<Database>, from: string, to: string, limit: number) => Promise<Examination[]>;
}

/**
 * Raiz de composição mínima para o processo "worker" (M8, `alerts.scan`): mesmo critério de
 * `appointments` `createAppointmentsReminderQueries` — nunca `access`/`clinics`/`documents`
 * (processo de sistema, sem ator a autorizar).
 */
export function createExaminationsReminderQueries(_deps: { db: Kysely<Database> }): ExaminationsReminderQueries {
  const examinationsRepo = new KyselyExaminationsRepository();
  return {
    listReminderCandidates: (trx, from, to, limit) => examinationsRepo.listReminderCandidates(trx, from, to, limit),
  };
}
