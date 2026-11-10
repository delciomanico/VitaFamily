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
import { InMemoryRateLimiter } from "../../platform/rate-limit/index.js";
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
import type { ExaminationsDeps, ExamAlertsPort, ExamOrderLinkerPort, ExamReportGeneratorPort, ReceiptIdsPort } from "./application/ports.js";
import { createDiscardResultsDraftUseCase, createDownloadExamReportUseCase, createGetResultsDraftUseCase, createSaveResultsDraftUseCase } from "./application/results-draft.js";
import { createSetExaminationStatusUseCase } from "./application/set-examination-status.js";
import { createUpdateExaminationUseCase } from "./application/update-examination.js";
import { createUpdateExamResultUseCase } from "./application/update-exam-result.js";
import { KyselyExamResultsDraftRepository, KyselyExamResultsRepository, KyselyExaminationsRepository } from "./infrastructure/repo.js";
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
  /** M14 R (BR-CLN-31): `receiptId` nos exames concluídos — ligada no composition root a `clinic-receipts`. */
  receipts: ReceiptIdsPort<Kysely<Database>>;
  /** M15 T (BR-CLN-48/49): laudo PDF — ligada no composition root a `clinic-reports` (`examinations` não o importa). */
  reportGenerator: ExamReportGeneratorPort<Kysely<Database>>;
  /** M15 U (BR-CLN-52): estado do pedido de exame ligado — ligada no composition root a `clinic-reports` (`examinations` não o importa). */
  examOrders: ExamOrderLinkerPort<Kysely<Database>>;
  clock: Clock;
}

/** Facto mínimo de uma origem de recomendação (modules.md §3 nota 22): nunca o registo completo. */
export interface ClinicExamOrigin {
  familyId: string;
  memberId: string;
  status: string;
  clinicName?: string;
}

/** M14 P (`clinic-patients`, calendário/ficha/pesquisa): facto mínimo de um exame da clínica (nunca o registo completo). */
export interface ClinicExamFact {
  id: string;
  status: "SCHEDULED" | "COMPLETED";
  startsAt: Date;
  examType?: string;
  slotId?: string;
  familyId: string;
  memberId: string;
  notes?: string;
  responseNote?: string;
  /** Nº de parâmetros emitidos pela clínica (nunca os valores); 0 se não pedido. */
  resultsCount: number;
}

/** M14 P (BR-CLN-21, histórico partilhado): exame com os parâmetros de resultado, sem documentos, notas nem interpretação (D11). */
export interface SharedExamFact {
  name: string;
  examDate: string;
  status: "SCHEDULED" | "COMPLETED";
  results: { parameter: string; valueNumeric: number | null; valueText: string | null; unit: string | null; referenceMin: number | null; referenceMax: number | null }[];
}

/** M14 R: exame da própria clínica visto pelo recibo (nome do retrato; `familyId`/`memberId` SÓ no servidor). */
export interface ClinicExamReceiptFacts {
  status: string;
  patientName: string;
  slotId?: string;
  familyId: string;
  memberId: string;
}

export interface ExaminationsModule {
  router: Router;
  /** M14 P (`clinic-patients`, só leitura; ligado no composition root): exames da própria clínica por janela/membro. */
  listClinicFacts: (
    trx: Kysely<Database>,
    clinicId: string,
    filter: { from?: Date; to?: Date; familyId?: string; memberId?: string },
    options?: { limit?: number; withResultsCount?: boolean },
  ) => Promise<ClinicExamFact[]>;
  /** M14 P (BR-CLN-21, `clinic-patients`, só leitura): exames do membro desde `since` (AAAA-MM-DD) e futuros, com parâmetros de resultado. */
  listSharedExams: (trx: Kysely<Database>, familyId: string, memberId: string, since: string) => Promise<SharedExamFact[]>;
  /** `/clinic-portal/exam-*` (D19) — ver `interface/clinic-portal-router.ts` para a decisão de onde vive. */
  clinicPortalRouter: Router;
  /** BR-APT-11 (`appointments.listAvailableSlots` kind=EXAM e `clinics` `ClinicSlotView`): exames `SCHEDULED` por horário. */
  countScheduledBySlot: (trx: Kysely<Database>, slotIds: string[]) => Promise<{ slotId: string; count: number }[]>;
  /** BR-CLN-08: porta de libertação dos PDF da clínica para `documents` (exame `COMPLETED`). */
  releaseGate: { isReleased: (trx: Kysely<Database>, document: { familyId: string; memberId: string; resourceId: string }) => Promise<boolean> };
  /** M14 R (BR-CLN-31, `clinic-receipts`, ligado no composition root): factos mínimos do exame da clínica para emitir recibo. */
  findReceiptFacts: (trx: Kysely<Database>, clinicId: string, examinationId: string) => Promise<ClinicExamReceiptFacts | null>;
  /** BR-CLN-09 (`recommendations`, ligado no composition root): "este exame pertence à clínica X e está no estado Y". */
  findClinicOrigin: (trx: Kysely<Database>, clinicId: string, examinationId: string, professionalId?: string) => Promise<ClinicExamOrigin | null>;
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
    draftsRepo: new KyselyExamResultsDraftRepository(),
    reportGenerator: deps.reportGenerator,
    examOrders: deps.examOrders,
    limiter: new InMemoryRateLimiter(deps.clock),
    policy: deps.access.policy,
    memberNames: { getMemberName: deps.access.getMemberName },
    alerts: deps.alerts,
    clinics: { getBookableClinic: deps.clinics.getBookableClinic, lockSlot: deps.clinics.lockClinicSlot, findSlotById: deps.clinics.findClinicSlotById },
    receipts: deps.receipts,
    documents: {
      listForResource: deps.documents.listForResource,
      deleteAllForResource: deps.documents.deleteAllForResource,
      uploadClinicExamDocument: deps.documents.uploadClinicExamDocument,
      deleteClinicExamDocument: deps.documents.deleteClinicExamDocument,
      storeGenerated: deps.documents.storeGenerated,
      discardStored: deps.documents.discardStored,
      readGeneratedExamReport: deps.documents.readGeneratedExamReport,
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
    getClinicExamResultsDraft: createGetResultsDraftUseCase(examinationsDeps),
    saveClinicExamResultsDraft: createSaveResultsDraftUseCase(examinationsDeps),
    discardClinicExamResultsDraft: createDiscardResultsDraftUseCase(examinationsDeps),
    getClinicExamReportPdf: createDownloadExamReportUseCase(examinationsDeps),
  };

  return {
    router: createExaminationsRouter(controller),
    clinicPortalRouter: createExaminationsClinicPortalRouter(clinicPortalController),
    countScheduledBySlot: (trx, slotIds) => examinationsRepo.countScheduledBySlot(trx, slotIds),
    listClinicFacts: async (trx, clinicId, filter, options = {}) => {
      const exams = await examinationsRepo.listForClinic(trx, clinicId, filter, options.limit);
      const facts: ClinicExamFact[] = [];
      for (const exam of exams) {
        if (exam.scheduledAt === undefined || exam.status === "CANCELLED") continue;
        const resultsCount = options.withResultsCount && exam.issuedBy === "CLINIC" ? (await examResultsRepo.listByExamination(trx, exam.id)).length : 0;
        facts.push({
          id: exam.id,
          status: exam.status,
          startsAt: exam.scheduledAt,
          familyId: exam.familyId,
          memberId: exam.memberId,
          resultsCount,
          ...(exam.name ? { examType: exam.name } : {}),
          ...(exam.slotId ? { slotId: exam.slotId } : {}),
          ...(exam.notes ? { notes: exam.notes } : {}),
          ...(exam.responseNote ? { responseNote: exam.responseNote } : {}),
        });
      }
      return facts;
    },
    listSharedExams: async (trx, familyId, memberId, since) => {
      const exams = await examinationsRepo.listSharedByMember(trx, familyId, memberId, since);
      const shared: SharedExamFact[] = [];
      for (const exam of exams) {
        if (exam.status === "CANCELLED") continue;
        const results = await examResultsRepo.listByExamination(trx, exam.id);
        shared.push({
          name: exam.name,
          examDate: exam.examDate,
          status: exam.status,
          results: results.map((r) => ({
            parameter: r.parameter,
            valueNumeric: r.valueNumeric ?? null,
            valueText: r.valueText ?? null,
            unit: r.unit ?? null,
            referenceMin: r.referenceMin ?? null,
            referenceMax: r.referenceMax ?? null,
          })),
        });
      }
      return shared;
    },
    findReceiptFacts: async (trx, clinicId, examinationId) => {
      const examination = await examinationsRepo.findByClinicId(trx, clinicId, examinationId);
      if (!examination) return null;
      const patientName = (await deps.access.getMemberName(trx, examination.familyId, examination.memberId)) ?? "Membro da família";
      return { status: examination.status, patientName, familyId: examination.familyId, memberId: examination.memberId, ...(examination.slotId ? { slotId: examination.slotId } : {}) };
    },
    findClinicOrigin: async (trx, clinicId, examinationId, professionalId) => {
      const examination = await examinationsRepo.findByClinicId(trx, clinicId, examinationId);
      // BR-CLN-39: o Médico só vê origens do seu profissional.
      if (examination && professionalId && (!examination.slotId || (await deps.clinics.findClinicSlotById(examination.slotId))?.professionalId !== professionalId)) return null;
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
