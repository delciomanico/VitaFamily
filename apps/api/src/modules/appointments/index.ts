// Raiz do módulo `appointments` (ADR-015/conventions.md §1): única API pública importável por
// outros módulos (`alerts`, `reports` — M8+, modules.md §2) e pelo composition root
// (`main/api.ts`). M7 (plan.md §4): Appointment e o seu ciclo de vida (FR-APT). Depende de
// `access` (autorização por categoria APPOINTMENTS), `clinics` (`ClinicLookup`, modules.md §2) e
// `audit` — nunca de `examinations`/`clinics` para além do lookup público.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import type { ClinicsModule } from "../clinics/index.js";
import { createCreateAppointmentUseCase } from "./application/create-appointment.js";
import { createDeleteAppointmentUseCase } from "./application/delete-appointment.js";
import { createGetAppointmentUseCase } from "./application/get-appointment.js";
import { createListAppointmentsUseCase } from "./application/list-appointments.js";
import type { AppointmentsDeps } from "./application/ports.js";
import { createSetAppointmentStatusUseCase } from "./application/set-appointment-status.js";
import { createUpdateAppointmentUseCase } from "./application/update-appointment.js";
import { KyselyAppointmentsRepository } from "./infrastructure/repo.js";
import { createAppointmentsRouter, type AppointmentsController } from "./interface/router.js";

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
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createAppointmentsModule(deps: AppointmentsModuleDeps): AppointmentsModule {
  const appointmentsRepo = new KyselyAppointmentsRepository();

  const appointmentsDeps: AppointmentsDeps<Kysely<Database>> = {
    appointmentsRepo,
    policy: deps.access.policy,
    clinics: { getBookableClinic: deps.clinics.getBookableClinic },
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
  };

  return { router: createAppointmentsRouter(controller) };
}
