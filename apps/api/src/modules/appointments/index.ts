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
import { createCancelClinicAppointmentUseCase, createListClinicAgendaUseCase, createListClinicRequestsUseCase, createRespondClinicRequestUseCase } from "./application/clinic-appointments.js";
import { createCreateAppointmentUseCase } from "./application/create-appointment.js";
import { createDeleteAppointmentUseCase } from "./application/delete-appointment.js";
import { createGetAppointmentUseCase } from "./application/get-appointment.js";
import { createListAppointmentsUseCase } from "./application/list-appointments.js";
import { createListAvailableSlotsUseCase } from "./application/list-available-slots.js";
import type { AppointmentsDeps } from "./application/ports.js";
import { createSetAppointmentStatusUseCase } from "./application/set-appointment-status.js";
import { createUpdateAppointmentUseCase } from "./application/update-appointment.js";
import { KyselyAppointmentsRepository } from "./infrastructure/repo.js";
import { createAppointmentsClinicPortalRouter, type AppointmentsClinicPortalController } from "./interface/clinic-portal-router.js";
import { toAppointmentPage } from "./interface/dto.js";
import { createAppointmentsRouter, type AppointmentsController } from "./interface/router.js";
import type { Appointment } from "./domain/appointment.js";

export type { Appointment, AppointmentStatus } from "./domain/appointment.js";

export interface AppointmentsModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  clinics: ClinicsModule;
  clock: Clock;
}

export interface AppointmentsModule {
  router: Router;
  /** `/clinic-portal/requests/*` e `/clinic-portal/agenda/*` (D17) — ver `interface/clinic-portal-router.ts`
   * para a decisão de porque vive aqui e não em `clinics`. */
  clinicPortalRouter: Router;
  /** Leituras para `reports` (mesma autorização e auditoria dos endpoints GET). */
  reads: { appointments: MemberPageRead };
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createAppointmentsModule(deps: AppointmentsModuleDeps): AppointmentsModule {
  const appointmentsRepo = new KyselyAppointmentsRepository();

  const appointmentsDeps: AppointmentsDeps<Kysely<Database>> = {
    appointmentsRepo,
    policy: deps.access.policy,
    membership: { getMembershipFacts: deps.access.getMembershipFacts },
    memberNames: { getMemberName: deps.access.getMemberName },
    clinics: {
      getBookableClinic: deps.clinics.getBookableClinic,
      listFreeSlots: deps.clinics.listFreeClinicSlots,
      findSlot: deps.clinics.findClinicSlot,
    },
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
    listAvailableSlots: createListAvailableSlotsUseCase(appointmentsDeps),
  };

  const clinicPortalController: AppointmentsClinicPortalController = {
    listClinicRequests: createListClinicRequestsUseCase(appointmentsDeps),
    respondClinicRequest: createRespondClinicRequestUseCase(appointmentsDeps),
    listClinicAgenda: createListClinicAgendaUseCase(appointmentsDeps),
    cancelClinicAppointment: createCancelClinicAppointmentUseCase(appointmentsDeps),
  };

  return {
    router: createAppointmentsRouter(controller),
    clinicPortalRouter: createAppointmentsClinicPortalRouter(clinicPortalController),
    reads: {
      appointments: async (actor, familyId, memberId, query, context) => toAppointmentPage(await controller.listAppointments(actor, familyId, memberId, query, context)),
    },
  };
}

export interface AppointmentsReminderQueries {
  listReminderCandidates: (trx: Kysely<Database>, now: Date, outcomeWindowMs: number, limit: number) => Promise<Appointment[]>;
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
    listReminderCandidates: (trx, now, outcomeWindowMs, limit) => appointmentsRepo.listReminderCandidates(trx, now, outcomeWindowMs, limit),
    setOutcomeRequested: (trx, appointmentId, requestedAt) => appointmentsRepo.setOutcomeRequested(trx, appointmentId, requestedAt),
  };
}
