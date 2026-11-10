// Raiz do módulo `appointments` (ADR-015/conventions.md §1): única API pública importável por
// outros módulos (`alerts`, `reports` — M8+, modules.md §2) e pelo composition root
// (`main/api.ts`). M7 (plan.md §4): Appointment e o seu ciclo de vida (FR-APT). Depende de
// `access` (autorização por categoria APPOINTMENTS), `clinics` (`ClinicLookup`, modules.md §2) e
// `audit` — nunca de `examinations`/`clinics` para além do lookup público.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { MemberPageRead } from "../../platform/reads/index.js";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import type { ClinicsModule } from "../clinics/index.js";
import {
  createArriveClinicAppointmentUseCase,
  createClearClinicFollowUpUseCase,
  createConfirmClinicAppointmentByPhoneUseCase,
  createNoShowClinicAppointmentUseCase,
  createSetClinicFollowUpUseCase,
  createStartClinicAppointmentUseCase,
} from "./application/clinic-day-flow.js";
import {
  createCancelClinicAppointmentUseCase,
  createCompleteClinicAppointmentUseCase,
  createListClinicAgendaUseCase,
  createListClinicRequestsUseCase,
  createRespondClinicRequestUseCase,
} from "./application/clinic-appointments.js";
import { createClinicPatientLookupUseCase, createCreateWalkInAppointmentUseCase } from "./application/clinic-walk-in.js";
import { createCreateAppointmentUseCase } from "./application/create-appointment.js";
import { createDeleteAppointmentUseCase } from "./application/delete-appointment.js";
import { createGetAppointmentUseCase } from "./application/get-appointment.js";
import { createListAppointmentsUseCase } from "./application/list-appointments.js";
import { createListAvailableSlotsUseCase } from "./application/list-available-slots.js";
import type { AppointmentsDeps, ClinicAppointmentsFilter, ClinicPatientDirectoryPort, ClinicPrescriptionInput, ConsultationReportsPort, PatientDirectoryPort, ReceiptIdsPort, ReminderWindows, RequestContext } from "./application/ports.js";
import { createSetAppointmentConfirmationUseCase } from "./application/set-appointment-confirmation.js";
import { createSetAppointmentStatusUseCase } from "./application/set-appointment-status.js";
import { createUpdateAppointmentUseCase } from "./application/update-appointment.js";
import { WalkInInMemoryRateLimiter, type WalkInRateLimiter } from "./domain/walk-in.js";
import { KyselyAppointmentsRepository } from "./infrastructure/repo.js";
import { createAppointmentsClinicPortalRouter, type AppointmentsClinicPortalController } from "./interface/clinic-portal-router.js";
import { toAppointmentPage } from "./interface/dto.js";
import { createAppointmentsRouter, type AppointmentsController } from "./interface/router.js";
import type { Appointment } from "./domain/appointment.js";

export type { Appointment, AppointmentStatus, ConfirmationSource, ConfirmationStatus } from "./domain/appointment.js";
export type { ReminderWindows } from "./application/ports.js";

/**
 * D18 (BR-CLN-06/BR-RX-07): a função pública `prescriptions.issuePrescriptionForClinic` devolve
 * `PrescriptionView` (mais campos do que `{ id }`) — assinalável aqui por covariância estrutural,
 * sem `appointments` importar `modules/prescriptions` (ver `PrescriptionsPort` em
 * `application/ports.ts`).
 */
export interface AppointmentsPrescriptionsDeps {
  issuePrescriptionForClinic: (
    trx: Kysely<Database>,
    familyId: string,
    memberId: string,
    input: ClinicPrescriptionInput,
    origin: { clinicAccountId: string; appointmentId: string },
    context: RequestContext,
  ) => Promise<{ id: string }>;
}

export interface AppointmentsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clinics: ClinicsModule;
  /** D19: ocupação de horários `EXAM` — ligada à API pública de `examinations` no composition root
   * (BR-APT-06/10; `appointments` não importa `examinations`). */
  examSlotOccupancy: { countScheduledBySlot: (trx: Kysely<Database>, slotIds: string[]) => Promise<{ slotId: string; count: number }[]> };
  /** Composition root liga à API pública de `prescriptions` (modules.md §3 notas 16/20: nenhuma
   * aresta nova no grafo — `appointments` continua a não importar `modules/prescriptions`). */
  prescriptions: AppointmentsPrescriptionsDeps;
  /** D20 (ADR-024): resolução do paciente por e-mail exato, ligada no composition root a `users`+`families`
   * (nenhuma aresta nova no grafo; `appointments` não importa esses módulos). */
  patients: PatientDirectoryPort<Kysely<Database>>;
  /** M14 P (BR-CLN-18, modules.md §2 nota 24): pacientes da clínica e visitas manuais — ligada no composition root à
   * API pública de `clinic-patients` (`appointments` não a importa). */
  clinicPatients: ClinicPatientDirectoryPort<Kysely<Database>>;
  /** M14 R (BR-CLN-31): `receiptId` nas marcações concluídas — ligada no composition root a `clinic-receipts`. */
  receipts: ReceiptIdsPort<Kysely<Database>>;
  /** M15 S (BR-CLN-42/45): relatório da consulta — ligada no composition root a `clinic-reports` (`appointments` não o importa). */
  consultationReports: ConsultationReportsPort<Kysely<Database>>;
  clock: Clock;
}

export interface AppointmentsModule {
  router: Router;
  /** `/clinic-portal/requests/*` e `/clinic-portal/agenda/*` (D17) — ver `interface/clinic-portal-router.ts`
   * para a decisão de porque vive aqui e não em `clinics`. */
  clinicPortalRouter: Router;
  /** Leituras para `reports` (mesma autorização e auditoria dos endpoints GET). */
  reads: { appointments: MemberPageRead };
  /** BR-CLN-04/BR-APT-11 (`clinics`, ligado no composition root): consultas `REQUESTED`/`SCHEDULED` por horário. */
  countActiveBySlot: (trx: Kysely<Database>, slotIds: string[]) => Promise<{ slotId: string; requested: number; scheduled: number }[]>;
  /** M14 P (BR-CLN-20, `clinic-patients`): o limiter do walk-in (BR-CLN-10), partilhado com a ligação por código. */
  walkInRateLimiter: WalkInRateLimiter;
  /** M14 P (`clinic-patients`, só leitura): consultas da própria clínica por janela/membro (calendário, ficha, pesquisa). */
  listClinicFacts: (trx: Kysely<Database>, clinicId: string, filter: ClinicAppointmentsFilter, limit?: number) => Promise<ClinicAppointmentFact[]>;
  /** M14 Q (BR-CLN-30, `clinic-patients`, só leitura): retornos por tratar da clínica (consultas `COMPLETED` com `followUpDueOn <= until`). */
  listClinicFollowUps: (trx: Kysely<Database>, clinicId: string, until: string, limit: number) => Promise<ClinicFollowUpFact[]>;
  /** M14 R (BR-CLN-31, `clinic-receipts`, ligado no composition root): factos mínimos da consulta da clínica para emitir recibo. */
  findReceiptFacts: (trx: Kysely<Database>, clinicId: string, appointmentId: string) => Promise<ReceiptBookingFacts | null>;
  /** M15 S (BR-CLN-41, `clinic-reports`, ligado no composition root): factos mínimos da consulta da clínica para o relatório (sem ids Vita). */
  findReportFacts: (trx: Kysely<Database>, clinicId: string, appointmentId: string) => Promise<ReportBookingFacts | null>;
  /** M15 S (BR-CLN-45, `clinic-reports`): a consulta existe no membro/família e a sua clínica — sem dados clínicos. */
  findFamilyAppointmentClinic: (trx: Kysely<Database>, familyId: string, memberId: string, appointmentId: string) => Promise<{ clinicId: string } | null>;
  /** BR-CLN-09 (`recommendations`, ligado no composition root): "esta consulta pertence à clínica X e está no estado Y". */
  findClinicOrigin: (trx: Kysely<Database>, clinicId: string, appointmentId: string, professionalId?: string) => Promise<ClinicOrigin | null>;
}

/** M14 P: facto mínimo de uma consulta da clínica para o calendário/ficha/pesquisa (nunca o registo completo). */
export interface ClinicAppointmentFact {
  id: string;
  status: "REQUESTED" | "SCHEDULED" | "REJECTED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  startsAt: Date;
  durationMinutes: number;
  specialty?: string;
  professionalName?: string;
  slotId?: string;
  familyId: string;
  memberId: string;
  notes?: string;
  responseNote?: string;
  /** M14 Q (BR-CLN-25/28): estado de confirmação e fluxo do dia (Hoje, calendário, indicadores). */
  confirmationStatus: "PENDING" | "CONFIRMED" | "DECLINED";
  arrivedAt?: Date;
  startedAt?: Date;
}

/** M14 Q: retorno por tratar de uma consulta Vita (nunca o registo completo). */
export interface ClinicFollowUpFact {
  id: string;
  familyId: string;
  memberId: string;
  dueOn: string;
  slotId?: string;
}

/** M14 R: consulta da própria clínica vista pelo recibo (nome do retrato; `familyId`/`memberId` SÓ no servidor). */
export interface ReceiptBookingFacts {
  status: string;
  patientName: string;
  slotId?: string;
  familyId: string;
  memberId: string;
}

/** M15 S: consulta da própria clínica vista pelo relatório (`familyId`/`memberId` SÓ no servidor, para resolver o paciente da clínica). */
export interface ReportBookingFacts {
  status: string;
  patientName: string;
  scheduledAt: Date;
  specialty?: string;
  slotId?: string;
  familyId: string;
  memberId: string;
  /** M15 V (BR-CLN-55): chegada registada (declaração de presença). */
  arrivedAt?: Date;
}

/** Facto mínimo de uma origem de recomendação (modules.md §3 nota 22): nunca o registo completo. */
export interface ClinicOrigin {
  familyId: string;
  memberId: string;
  status: string;
  clinicName?: string;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createAppointmentsModule(deps: AppointmentsModuleDeps): AppointmentsModule {
  const appointmentsRepo = new KyselyAppointmentsRepository();
  const walkInRateLimiter = new WalkInInMemoryRateLimiter(deps.clock);

  const appointmentsDeps: AppointmentsDeps<Kysely<Database>> = {
    appointmentsRepo,
    policy: deps.access.policy,
    membership: { getMembershipFacts: deps.access.getMembershipFacts },
    memberNames: { getMemberName: deps.access.getMemberName },
    clinics: {
      getBookableClinic: deps.clinics.getBookableClinic,
      listFreeSlots: deps.clinics.listFreeClinicSlots,
      findSlot: deps.clinics.findClinicSlot,
      lockSlot: deps.clinics.lockClinicSlot,
      listProfessionalSlotsOverlapping: deps.clinics.listProfessionalSlotsOverlapping,
    },
    examSlotOccupancy: deps.examSlotOccupancy,
    prescriptions: { issueForClinic: deps.prescriptions.issuePrescriptionForClinic },
    patients: deps.patients,
    clinicPatients: deps.clinicPatients,
    receipts: deps.receipts,
    consultationReports: deps.consultationReports,
    walkInRateLimiter,
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const controller: AppointmentsController = {
    listAppointments: createListAppointmentsUseCase(appointmentsDeps),
    createAppointment: createCreateAppointmentUseCase(appointmentsDeps),
    getAppointment: createGetAppointmentUseCase(appointmentsDeps),
    updateAppointment: createUpdateAppointmentUseCase(appointmentsDeps),
    deleteAppointment: createDeleteAppointmentUseCase(appointmentsDeps),
    setAppointmentStatus: createSetAppointmentStatusUseCase(appointmentsDeps),
    setAppointmentConfirmation: createSetAppointmentConfirmationUseCase(appointmentsDeps),
    listAvailableSlots: createListAvailableSlotsUseCase(appointmentsDeps),
  };

  const clinicPortalController: AppointmentsClinicPortalController = {
    listClinicRequests: createListClinicRequestsUseCase(appointmentsDeps),
    respondClinicRequest: createRespondClinicRequestUseCase(appointmentsDeps),
    listClinicAgenda: createListClinicAgendaUseCase(appointmentsDeps),
    cancelClinicAppointment: createCancelClinicAppointmentUseCase(appointmentsDeps),
    completeClinicAppointment: createCompleteClinicAppointmentUseCase(appointmentsDeps),
    confirmClinicAppointmentByPhone: createConfirmClinicAppointmentByPhoneUseCase(appointmentsDeps),
    arriveClinicAppointment: createArriveClinicAppointmentUseCase(appointmentsDeps),
    startClinicAppointment: createStartClinicAppointmentUseCase(appointmentsDeps),
    noShowClinicAppointment: createNoShowClinicAppointmentUseCase(appointmentsDeps),
    setClinicFollowUp: createSetClinicFollowUpUseCase(appointmentsDeps),
    clearClinicFollowUp: createClearClinicFollowUpUseCase(appointmentsDeps),
    clinicPatientLookup: createClinicPatientLookupUseCase(appointmentsDeps),
    createClinicWalkInAppointment: createCreateWalkInAppointmentUseCase(appointmentsDeps),
  };

  return {
    router: createAppointmentsRouter(controller),
    clinicPortalRouter: createAppointmentsClinicPortalRouter(clinicPortalController),
    countActiveBySlot: (trx, slotIds) => appointmentsRepo.countActiveBySlot(trx, slotIds),
    walkInRateLimiter,
    listClinicFacts: async (trx, clinicId, filter, limit) =>
      (await appointmentsRepo.listForClinic(trx, clinicId, filter, limit)).map((a) => ({
        id: a.id,
        status: a.status,
        startsAt: a.scheduledAt,
        durationMinutes: a.durationMinutes ?? 30,
        familyId: a.familyId,
        memberId: a.memberId,
        ...(a.specialty ? { specialty: a.specialty } : {}),
        ...(a.professionalName ? { professionalName: a.professionalName } : {}),
        ...(a.slotId ? { slotId: a.slotId } : {}),
        ...(a.notes ? { notes: a.notes } : {}),
        ...(a.responseNote ? { responseNote: a.responseNote } : {}),
        confirmationStatus: a.confirmationStatus,
        ...(a.arrivedAt ? { arrivedAt: a.arrivedAt } : {}),
        ...(a.startedAt ? { startedAt: a.startedAt } : {}),
      })),
    listClinicFollowUps: async (trx, clinicId, until, limit) =>
      (await appointmentsRepo.listFollowUpsByClinic(trx, clinicId, until, limit)).flatMap((a) => (a.followUpDueOn ? [{ id: a.id, familyId: a.familyId, memberId: a.memberId, dueOn: a.followUpDueOn, ...(a.slotId ? { slotId: a.slotId } : {}) }] : [])),
    findReceiptFacts: async (trx, clinicId, appointmentId) => {
      const appointment = await appointmentsRepo.findByClinicId(trx, clinicId, appointmentId);
      if (!appointment) return null;
      const patientName = (await deps.access.getMemberName(trx, appointment.familyId, appointment.memberId)) ?? "Membro da família";
      return { status: appointment.status, patientName, familyId: appointment.familyId, memberId: appointment.memberId, ...(appointment.slotId ? { slotId: appointment.slotId } : {}) };
    },
    findReportFacts: async (trx, clinicId, appointmentId) => {
      const appointment = await appointmentsRepo.findByClinicId(trx, clinicId, appointmentId);
      if (!appointment) return null;
      const patientName = (await deps.access.getMemberName(trx, appointment.familyId, appointment.memberId)) ?? "Membro da família";
      return {
        status: appointment.status,
        patientName,
        scheduledAt: appointment.scheduledAt,
        familyId: appointment.familyId,
        memberId: appointment.memberId,
        ...(appointment.specialty ? { specialty: appointment.specialty } : {}),
        ...(appointment.slotId ? { slotId: appointment.slotId } : {}),
        ...(appointment.arrivedAt ? { arrivedAt: appointment.arrivedAt } : {}),
      };
    },
    findFamilyAppointmentClinic: async (trx, familyId, memberId, appointmentId) => {
      const appointment = await appointmentsRepo.findById(trx, familyId, memberId, appointmentId);
      return appointment?.clinicId ? { clinicId: appointment.clinicId } : null;
    },
    findClinicOrigin: async (trx, clinicId, appointmentId, professionalId) => {
      const appointment = await appointmentsRepo.findByClinicId(trx, clinicId, appointmentId);
      // BR-CLN-39: o Médico só vê origens do seu profissional.
      if (appointment && professionalId && (!appointment.slotId || (await deps.clinics.findClinicSlot(clinicId, appointment.slotId))?.professionalId !== professionalId)) return null;
      return appointment
        ? { familyId: appointment.familyId, memberId: appointment.memberId, status: appointment.status, ...(appointment.clinicName ? { clinicName: appointment.clinicName } : {}) }
        : null;
    },
    reads: {
      appointments: async (actor, familyId, memberId, query, context) => toAppointmentPage(await controller.listAppointments(actor, familyId, memberId, query, context)),
    },
  };
}

export interface AppointmentsReminderQueries {
  listReminderCandidates: (trx: Kysely<Database>, now: Date, windows: ReminderWindows, limit: number) => Promise<Appointment[]>;
  /** BR-CLN-30: consultas `COMPLETED` com retorno em `[from, to]` (AAAA-MM-DD). */
  listFollowUpCandidates: (trx: Kysely<Database>, from: string, to: string, limit: number) => Promise<Appointment[]>;
  setOutcomeRequested: (trx: Kysely<Database>, appointmentId: string, requestedAt: Date) => Promise<void>;
}

/**
 * Raiz de composição mínima para o processo "worker" (M8, `alerts.scan`): só o necessário para o
 * scanner (nunca `access`/`clinics` — processo de sistema, sem ator a autorizar nem nome de
 * clínica a resolver; mesmo critério de `medications` `MedicationsWorkerDeps`).
 */
export function createAppointmentsReminderQueries(_deps: { db: Kysely<Database> }): AppointmentsReminderQueries {
  const appointmentsRepo = new KyselyAppointmentsRepository();
  return {
    listReminderCandidates: (trx, now, windows, limit) => appointmentsRepo.listReminderCandidates(trx, now, windows, limit),
    listFollowUpCandidates: (trx, from, to, limit) => appointmentsRepo.listFollowUpCandidates(trx, from, to, limit),
    setOutcomeRequested: (trx, appointmentId, requestedAt) => appointmentsRepo.setOutcomeRequested(trx, appointmentId, requestedAt),
  };
}
