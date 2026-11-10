// Raiz do módulo `clinic-reports` (ADR-015/conventions.md §1, M15 S/T/U/V, ADR-027/ADR-028, modules.md §2 notas 27/28): pedido de exame
// (`ExamOrder`, ponte, PDF), declaração de presença e relatório da consulta
// (`ConsultationReport`, adendas), PDF do relatório e layout do laudo de exame (realce aritmético puro); rotas
// `/clinic-portal/agenda/{id}/report*` (ator `ClinicAccount`, matriz de authorization.md §6.2b) e
// `/families/{f}/members/{m}/appointments/{id}/report*` (ator `User`, §6.6). Depende só de `clinics` (via portas) e `audit`;
// NÃO importa `auth`, `access`, `families`, `insurance`, `insurer-ops`, `clinic-receipts` nem módulos de saúde: marcação, perfil,
// profissionais e autorização do paciente entram por portas ligadas no composition root.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import { withTransaction, type Database } from "../../platform/db/index.js";
import { InMemoryRateLimiter } from "../../platform/rate-limit/index.js";
import type { AuditModule } from "../audit/index.js";
import {
  createAddAddendumUseCase,
  createFinalizeReportUseCase,
  createFinalizeWithCompleteUseCase,
  createGetReportPdfUseCase,
  createGetReportUseCase,
  createReportStatusesUseCase,
  createSaveReportUseCase,
  createSharedReportAvailabilityUseCase,
} from "./application/clinic-reports.js";
import { createGetAttendanceStatementPdfUseCase } from "./application/attendance-statement.js";
import { createExamReportGeneratorUseCase } from "./application/exam-report.js";
import {
  createAppointmentExamOrderCountsUseCase,
  createCancelExamOrderUseCase,
  createCreateExamOrdersUseCase,
  createCreateWithCompleteUseCase,
  createExamOrderCountsUseCase,
  createGetExamOrdersPdfUseCase,
  createListExamOrdersUseCase,
} from "./application/exam-orders.js";
import { createExamOrderLinker, createListFamilyExamOrdersUseCase } from "./application/family-exam-orders.js";
import { createGetFamilyReportPdfUseCase, createGetFamilyReportUseCase } from "./application/family-reports.js";
import type {
  BookingSourcePort,
  ClinicProfileReaderPort,
  ClinicReportsDeps,
  ExamOrderAlertsPort,
  ExamServiceCatalogPort,
  FamilyAppointmentLookupPort,
  PatientAccessPort,
  PdfRendererPort,
  ProfessionalReaderPort,
} from "./application/ports.js";
import { KyselyExamOrdersRepository } from "./infrastructure/exam-orders-repo.js";
import { KyselyReportsRepository } from "./infrastructure/repo.js";
import { PdfKitRenderer } from "./infrastructure/pdfkit-renderer.js";
import { createClinicReportsFamilyRouter } from "./interface/family-router.js";
import { createClinicReportsPortalRouter } from "./interface/portal-router.js";

export type { BookingFacts, BookingSourcePort, ClinicProfileReaderPort, ExamOrderAlertsPort, ExamServiceCatalogPort, FamilyAppointmentLookupPort, PatientAccessPort, PdfRendererPort, ProfessionalReaderPort } from "./application/ports.js";
export type { ConsultationBookingKind } from "./domain/consultation-report.js";
export type { ExamReportRequest, GeneratedExamReport } from "./application/exam-report.js";
export type { LinkExamOrderInput, FamilyExamOrderView } from "./application/family-exam-orders.js";
export { PdfKitRenderer } from "./infrastructure/pdfkit-renderer.js";

export interface ClinicReportsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  /** Marcação da clínica (implementada por `appointments` e `clinic-patients`). */
  bookings: BookingSourcePort<Kysely<Database>>;
  /** A consulta existe no membro/família (implementada por `appointments`; sem dados clínicos). */
  familyAppointments: FamilyAppointmentLookupPort<Kysely<Database>>;
  /** Perfil da clínica (implementada por `clinics`). */
  profile: ClinicProfileReaderPort<Kysely<Database>>;
  /** Profissional do horário e nome (implementada por `clinics`). */
  professionals: ProfessionalReaderPort<Kysely<Database>>;
  /** `AccessPolicy.can(VIEW_CONSULTATION_REPORT)` (implementada por `access`). */
  patientAccess: PatientAccessPort<Kysely<Database>>;
  /** M15 U (modules.md §2 nota 28): alerta genérico `EXAM_ORDER_ADDED` (implementada no composition root sobre `alerts.raiseExamOrderEvent`). */
  orderAlerts: ExamOrderAlertsPort<Kysely<Database>>;
  /** M15 U (BR-CLN-51): serviço `EXAM` do catálogo da clínica (implementada por `clinics`). */
  services: ExamServiceCatalogPort<Kysely<Database>>;
  /** Por omissão `PdfKitRenderer`; substituível. */
  pdf?: PdfRendererPort;
}

export interface ClinicReportsModule {
  /** `/families/{f}/members/{m}/appointments/{id}/report*` (ator `User`). */
  router: Router;
  /** `/clinic-portal/agenda/{id}/report*` (ator `ClinicAccount`, ADR-020). */
  clinicPortalRouter: Router;
  /** Porta `ConsultationReportFinalizer` de `appointments` (`report` em `complete`, na transação do chamador). */
  finalizeWithComplete: ReturnType<typeof createFinalizeWithCompleteUseCase<Kysely<Database>>>;
  /** Porta `ExamReportGenerator` de `examinations` (laudo PDF do exame). */
  generateExamReport: ReturnType<typeof createExamReportGeneratorUseCase<Kysely<Database>>>;
  /** Decorar `ClinicBooking.reportStatus` (`appointments`). */
  reportStatuses: ReturnType<typeof createReportStatusesUseCase<Kysely<Database>>>;
  /** Decorar `Appointment.reportAvailable` (`appointments`). */
  sharedReportAvailability: ReturnType<typeof createSharedReportAvailabilityUseCase<Kysely<Database>>>;
  /** Porta `ExamOrderLinker` de `examinations` (`link`/`release`/`fulfil`, na transação do exame; M15 U, BR-CLN-52). */
  examOrderLinker: ReturnType<typeof createExamOrderLinker<Kysely<Database>>>;
  /** `examOrders` em `complete` (porta de `appointments`, na transação do chamador; BR-CLN-51). */
  createWithComplete: ReturnType<typeof createCreateWithCompleteUseCase<Kysely<Database>>>;
  /** Decorar `ClinicBooking.examOrderCount` (`appointments`). */
  examOrderCounts: ReturnType<typeof createExamOrderCountsUseCase<Kysely<Database>>>;
  /** Decorar `Appointment.examOrderCount` (`appointments`; só para SELF/TUTOR_OF). */
  appointmentExamOrderCounts: ReturnType<typeof createAppointmentExamOrderCountsUseCase<Kysely<Database>>>;
  /** Exportação do titular (`lifecycle`, BR-CLN-50): leitura do relatório partilhado de uma consulta Vita (mesma autorização e auditoria do endpoint). */
  reads: {
    familyReport: ReturnType<typeof createGetFamilyReportUseCase<Kysely<Database>>>;
    /** Exportação do titular (M15 U, BR-CLN-56): pedidos não cancelados do membro (mesma autorização do endpoint). */
    familyExamOrders: ReturnType<typeof createListFamilyExamOrdersUseCase<Kysely<Database>>>;
  };
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createClinicReportsModule(deps: ClinicReportsModuleDeps): ClinicReportsModule {
  const reportsDeps: ClinicReportsDeps<Kysely<Database>> = {
    ordersRepo: new KyselyExamOrdersRepository(),
    orderAlerts: deps.orderAlerts,
    services: deps.services,
    reportsRepo: new KyselyReportsRepository(),
    bookings: deps.bookings,
    familyAppointments: deps.familyAppointments,
    profile: deps.profile,
    professionals: deps.professionals,
    patientAccess: deps.patientAccess,
    pdf: deps.pdf ?? new PdfKitRenderer(),
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    limiter: new InMemoryRateLimiter(deps.clock),
    clock: deps.clock,
  };

  return {
    clinicPortalRouter: createClinicReportsPortalRouter({
      getClinicConsultationReport: createGetReportUseCase(reportsDeps),
      saveClinicConsultationReport: createSaveReportUseCase(reportsDeps),
      finalizeClinicConsultationReport: createFinalizeReportUseCase(reportsDeps),
      addClinicConsultationReportAddendum: createAddAddendumUseCase(reportsDeps),
      getClinicConsultationReportPdf: createGetReportPdfUseCase(reportsDeps),
      listClinicExamOrders: createListExamOrdersUseCase(reportsDeps),
      createClinicExamOrders: createCreateExamOrdersUseCase(reportsDeps),
      cancelClinicExamOrder: createCancelExamOrderUseCase(reportsDeps),
      getClinicExamOrdersPdf: createGetExamOrdersPdfUseCase(reportsDeps),
      getClinicAttendanceStatementPdf: createGetAttendanceStatementPdfUseCase(reportsDeps),
    }),
    router: createClinicReportsFamilyRouter({
      getFamilyConsultationReport: createGetFamilyReportUseCase(reportsDeps),
      getFamilyConsultationReportPdf: createGetFamilyReportPdfUseCase(reportsDeps),
      listFamilyExamOrders: createListFamilyExamOrdersUseCase(reportsDeps),
    }),
    finalizeWithComplete: createFinalizeWithCompleteUseCase(reportsDeps),
    generateExamReport: createExamReportGeneratorUseCase(reportsDeps),
    reportStatuses: createReportStatusesUseCase(reportsDeps),
    sharedReportAvailability: createSharedReportAvailabilityUseCase(reportsDeps),
    examOrderLinker: createExamOrderLinker(reportsDeps),
    createWithComplete: createCreateWithCompleteUseCase(reportsDeps),
    examOrderCounts: createExamOrderCountsUseCase(reportsDeps),
    appointmentExamOrderCounts: createAppointmentExamOrderCountsUseCase(reportsDeps),
    reads: { familyReport: createGetFamilyReportUseCase(reportsDeps), familyExamOrders: createListFamilyExamOrdersUseCase(reportsDeps) },
  };
}
