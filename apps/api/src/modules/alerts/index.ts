// Raiz do módulo `alerts` (ADR-015/conventions.md §1): única API pública importável pelo
// composition root (`main/api.ts`/`main/worker.ts`). M8 (plan.md §4): regras puras,
// destinatários, scanner e geração idempotente de alertas, listagem/leitura (FR-ALR). Depende de
// `medications`, `appointments`, `examinations`, `families` (modules.md §2) e `notifications`
// (modules.md §2 nota 15: a orquestração do pipeline Evento→Regra→Alerta→Notificação fica aqui,
// que chama `notifications` pela raiz — nunca o inverso).
//
// Duas raízes de composição (modules.md §4, mesmo padrão de `medications`): `createAlertsModule`
// (processo "api": só o `router` — `listAlerts`/`markAlertRead`/`markAllAlertsRead` não precisam
// de nenhuma porta de agenda, só do `families` para o nome do membro na vista) e
// `createAlertsWorkerModule` (processo "worker": o job `alerts.scan`, que é quem de facto usa as
// portas de `medications`/`appointments`/`examinations`).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type PgBoss from "pg-boss";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AppointmentsReminderQueries } from "../appointments/index.js";
import type { ExaminationsReminderQueries } from "../examinations/index.js";
import type { FamiliesModule } from "../families/index.js";
import type { MedicationsWorkerModule } from "../medications/index.js";
import type { NotificationsModule, NotificationsWorkerModule } from "../notifications/index.js";
import { createListAlertsUseCase } from "./application/list-alerts.js";
import { createMarkAlertReadUseCase } from "./application/mark-alert-read.js";
import { createMarkAllAlertsReadUseCase } from "./application/mark-all-alerts-read.js";
import type { AlertsApiDeps, AlertsWorkerDeps } from "./application/ports.js";
import { createScanJobUseCase } from "./application/scan-job.js";
import { registerScanWorker } from "./infrastructure/jobs.js";
import { KyselyAlertsRepository } from "./infrastructure/repo.js";
import { createAlertsRouter, type AlertsController } from "./interface/router.js";

export type { Alert, AlertSourceType, AlertType, RuleKey } from "./domain/alert.js";

export interface AlertsModuleDeps {
  db: Kysely<Database>;
  families: FamiliesModule;
  notifications: NotificationsModule;
  clock: Clock;
}

export interface AlertsModule {
  router: Router;
}

/** Composition root do processo "api" (main/api.ts). */
export function createAlertsModule(deps: AlertsModuleDeps): AlertsModule {
  const alertsRepo = new KyselyAlertsRepository();
  const alertsDeps: AlertsApiDeps<Kysely<Database>> = {
    alertsRepo,
    families: {
      findMemberById: deps.families.findMemberById,
      listGuardianUserIds: deps.families.listGuardianUserIds,
      getEffectiveTimezone: deps.families.getEffectiveTimezone,
    },
    notifications: {
      isTypeEnabled: deps.notifications.isTypeEnabled,
      enqueueForAlert: deps.notifications.enqueueForAlert,
      skipPendingForAlert: deps.notifications.skipPendingForAlert,
    },
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const controller: AlertsController = {
    listAlerts: createListAlertsUseCase(alertsDeps),
    markAlertRead: createMarkAlertReadUseCase(alertsDeps),
    markAllAlertsRead: createMarkAllAlertsReadUseCase(alertsDeps),
  };

  return { router: createAlertsRouter(controller) };
}

export interface AlertsWorkerModuleDeps {
  db: Kysely<Database>;
  families: FamiliesModule;
  medications: MedicationsWorkerModule;
  appointments: AppointmentsReminderQueries;
  examinations: ExaminationsReminderQueries;
  notifications: NotificationsWorkerModule;
  clock: Clock;
  boss: PgBoss;
}

export interface AlertsWorkerModule {
  /** Regista `alerts.scan` (1 min, modules.md §5). */
  registerWorkers: () => Promise<string[]>;
}

/** Composition root do processo "worker" (main/worker.ts). */
export function createAlertsWorkerModule(deps: AlertsWorkerModuleDeps): AlertsWorkerModule {
  const alertsRepo = new KyselyAlertsRepository();
  const alertsDeps: AlertsWorkerDeps<Kysely<Database>> = {
    alertsRepo,
    medications: { listReminderCandidates: deps.medications.listReminderCandidates },
    appointments: deps.appointments,
    examinations: deps.examinations,
    families: {
      findMemberById: deps.families.findMemberById,
      listGuardianUserIds: deps.families.listGuardianUserIds,
      getEffectiveTimezone: deps.families.getEffectiveTimezone,
    },
    notifications: {
      isTypeEnabled: deps.notifications.isTypeEnabled,
      enqueueForAlert: deps.notifications.enqueueForAlert,
      skipPendingForAlert: deps.notifications.skipPendingForAlert,
    },
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };
  const scanJob = createScanJobUseCase(alertsDeps);

  return {
    registerWorkers: async () => [await registerScanWorker(deps.boss, scanJob)],
  };
}
