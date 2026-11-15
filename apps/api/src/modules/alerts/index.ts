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
import type { InsurerOpsModule } from "../insurer-ops/index.js";
import type { MedicationsWorkerModule } from "../medications/index.js";
import type { ProcessesModule } from "../processes/index.js";
import type { NotificationsModule, NotificationsWorkerModule } from "../notifications/index.js";
import { createListAlertsUseCase } from "./application/list-alerts.js";
import { createMarkAlertReadUseCase } from "./application/mark-alert-read.js";
import { createMarkAllAlertsReadUseCase } from "./application/mark-all-alerts-read.js";
import type { AlertsApiDeps, AlertsWorkerDeps } from "./application/ports.js";
import { createRaiseExamEventUseCase, type RaiseExamEventInput } from "./application/raise-exam-event.js";
import { createRaiseRecommendationEventUseCase, type RaiseRecommendationEventInput } from "./application/raise-recommendation-event.js";
import { createRaiseExamOrderEventUseCase, type RaiseExamOrderEventInput } from "./application/raise-exam-order-event.js";
import { createRaiseAuthorizationEventUseCase, type RaiseAuthorizationEventInput } from "./application/raise-authorization-event.js";
import { createScanJobUseCase } from "./application/scan-job.js";
import { registerScanWorker } from "./infrastructure/jobs.js";
import { KyselyAlertsRepository } from "./infrastructure/repo.js";
import { createAlertsRouter, type AlertsController } from "./interface/router.js";

export type { Alert, AlertSourceType, AlertType, RuleKey } from "./domain/alert.js";

export interface AlertsModuleDeps {
  db: Kysely<Database>;
  families: FamiliesModule;
  notifications: NotificationsModule;
  /** Fatia 5 (ADR-036, modules.md nota 33): dono/«aberto» do processo (só leitura, pela raiz de `processes`). */
  processes: Pick<ProcessesModule, "describeForAlerts">;
  clock: Clock;
}

export interface AlertsModule {
  router: Router;
  /** D19/ADR-023: alerta de evento de exame na transação do chamador (ligado no composition root a `examinations`). */
  raiseExamEvent: (trx: Kysely<Database>, input: RaiseExamEventInput) => Promise<number>;
  /** D19/ADR-023 (BR-CLN-09): alerta `recommendation.added` na transação do chamador (ligado no composition root a `recommendations`). */
  raiseRecommendationEvent: (trx: Kysely<Database>, input: RaiseRecommendationEventInput) => Promise<number>;
  /** M15 U (ADR-028, BR-CLN-53): alerta `exam_order.added` na transação do chamador (ligado no composition root a `clinic-reports`). */
  raiseExamOrderEvent: (trx: Kysely<Database>, input: RaiseExamOrderEventInput) => Promise<number>;
  /** Fatia 5 (ADR-036, BR-ALR-10): alerta `authorization.*` na transação do chamador (ligado no composition root à porta `FamilyNotifier` de `insurer-ops`). */
  raiseAuthorizationEvent: (trx: Kysely<Database>, input: RaiseAuthorizationEventInput) => Promise<number>;
}

export type { RaiseAuthorizationEventInput } from "./application/raise-authorization-event.js";
export type { RaiseExamOrderEventInput } from "./application/raise-exam-order-event.js";
export type { RaiseRecommendationEventInput } from "./application/raise-recommendation-event.js";
export type { RaiseExamEventInput } from "./application/raise-exam-event.js";

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
    processes: { describe: (trx, processIds) => deps.processes.describeForAlerts(trx, processIds) },
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const controller: AlertsController = {
    listAlerts: createListAlertsUseCase(alertsDeps),
    markAlertRead: createMarkAlertReadUseCase(alertsDeps),
    markAllAlertsRead: createMarkAllAlertsReadUseCase(alertsDeps),
  };

  return {
    router: createAlertsRouter(controller),
    raiseExamEvent: createRaiseExamEventUseCase(alertsDeps),
    raiseRecommendationEvent: createRaiseRecommendationEventUseCase(alertsDeps),
    raiseExamOrderEvent: createRaiseExamOrderEventUseCase(alertsDeps),
    raiseAuthorizationEvent: createRaiseAuthorizationEventUseCase(alertsDeps),
  };
}

export interface AlertsWorkerModuleDeps {
  db: Kysely<Database>;
  families: FamiliesModule;
  medications: MedicationsWorkerModule;
  appointments: AppointmentsReminderQueries;
  examinations: ExaminationsReminderQueries;
  notifications: NotificationsWorkerModule;
  /** Fatia 5 (ADR-036): candidatas de `AUTHORIZATION_EXPIRING` (só leitura, pela raiz de `insurer-ops`). */
  insurerOps: Pick<InsurerOpsModule, "listExpiringApprovals">;
  /** Fatia 5 (ADR-036): dono/«aberto» do processo (só leitura, pela raiz de `processes`). */
  processes: Pick<ProcessesModule, "describeForAlerts">;
  clock: Clock;
  boss: PgBoss;
}

export interface AlertsWorkerModule {
  /** Regista `alerts.scan` (1 min, modules.md §5). */
  registerWorkers: () => Promise<string[]>;
  /** D19/BR-EXM-07: o job de expiração de pedidos (processo worker) também avisa a família. */
  raiseExamEvent: (trx: Kysely<Database>, input: RaiseExamEventInput) => Promise<number>;
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
    insurerOps: { listExpiringApprovals: (trx, from, to, limit) => deps.insurerOps.listExpiringApprovals(trx, from, to, limit) },
    processes: { describe: (trx, processIds) => deps.processes.describeForAlerts(trx, processIds) },
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };
  const scanJob = createScanJobUseCase(alertsDeps);

  return {
    registerWorkers: async () => [await registerScanWorker(deps.boss, scanJob)],
    raiseExamEvent: createRaiseExamEventUseCase(alertsDeps),
  };
}
