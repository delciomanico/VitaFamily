// Raiz do módulo `examinations` (ADR-015/conventions.md §1): única API pública importável por
// outros módulos (`alerts`, `reports` — M8+, modules.md §2) e pelo composition root
// (`main/api.ts`). M7 (plan.md §4): Examination e ExamResult (FR-EXM). Depende de `access`,
// `clinics` (`ClinicLookup`), `documents` (documentos do exame, FR-DOC-04) e `audit`.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import type { ClinicsModule } from "../clinics/index.js";
import type { DocumentsModule } from "../documents/index.js";
import { createAddExamResultUseCase } from "./application/add-exam-result.js";
import { createCreateExaminationUseCase } from "./application/create-examination.js";
import { createDeleteExaminationUseCase } from "./application/delete-examination.js";
import { createDeleteExamResultUseCase } from "./application/delete-exam-result.js";
import { createExamResultHistoryUseCase } from "./application/exam-result-history.js";
import { createGetExaminationUseCase } from "./application/get-examination.js";
import { createListExaminationsUseCase } from "./application/list-examinations.js";
import type { ExaminationsDeps } from "./application/ports.js";
import { createSetExaminationStatusUseCase } from "./application/set-examination-status.js";
import { createUpdateExaminationUseCase } from "./application/update-examination.js";
import { createUpdateExamResultUseCase } from "./application/update-exam-result.js";
import { KyselyExamResultsRepository, KyselyExaminationsRepository } from "./infrastructure/repo.js";
import { createExaminationsRouter, type ExaminationsController } from "./interface/router.js";

import type { Examination } from "./domain/examination.js";

export type { Examination, ExaminationStatus } from "./domain/examination.js";
export type { ExamResult } from "./domain/exam-result.js";

export interface ExaminationsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clinics: ClinicsModule;
  documents: DocumentsModule;
  clock: Clock;
}

export interface ExaminationsModule {
  router: Router;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createExaminationsModule(deps: ExaminationsModuleDeps): ExaminationsModule {
  const examinationsRepo = new KyselyExaminationsRepository();
  const examResultsRepo = new KyselyExamResultsRepository();

  const examinationsDeps: ExaminationsDeps<Kysely<Database>> = {
    examinationsRepo,
    examResultsRepo,
    policy: deps.access.policy,
    clinics: { getBookableClinic: deps.clinics.getBookableClinic },
    documents: {
      listForResource: deps.documents.listForResource,
      deleteAllForResource: deps.documents.deleteAllForResource,
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

  return { router: createExaminationsRouter(controller) };
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
