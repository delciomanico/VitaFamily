// Raiz do módulo `notifications` (ADR-015/conventions.md §1): única API pública importável por
// outros módulos (`alerts`, `lifecycle` — M8+, modules.md §2 nota 15) e pelo composition root
// (`main/api.ts`/`main/worker.ts`). M8 (plan.md §4): canais e entrega (push/e-mail),
// preferências, subscrições, retry (FR-ALR). Depende só de `users` (modules.md §2) — nunca de
// `alerts` (ver README.md: a orquestração do pipeline fica em `alerts`, que depende deste
// módulo, nunca o inverso).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type PgBoss from "pg-boss";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { UsersModule } from "../users/index.js";
import { createAddPushSubscriptionUseCase } from "./application/add-push-subscription.js";
import { createDeletePushSubscriptionUseCase } from "./application/delete-push-subscription.js";
import { createEnqueueForAlertUseCase, createIsTypeEnabledUseCase, createSkipPendingForAlertUseCase, type EnqueueForAlertInput } from "./application/for-alerts.js";
import { createGetPreferencesUseCase } from "./application/get-preferences.js";
import type { Mailer, NotificationsDeps, NotificationsWorkerDeps, PushSender } from "./application/ports.js";
import { createPutPreferencesUseCase } from "./application/put-preferences.js";
import { createSendJobUseCase } from "./application/send-job.js";
import type { AlertNotificationType } from "./domain/preference.js";
import { registerSendWorker } from "./infrastructure/jobs.js";
import { KyselyNotificationsRepository, KyselyPreferencesRepository, KyselyPushSubscriptionsRepository } from "./infrastructure/repo.js";
import { createNotificationsRouter, type NotificationsController } from "./interface/router.js";

export type { AlertNotificationType, Channel, NotificationPreference, NotificationPreferenceChanges } from "./domain/preference.js";
export type { NewPushSubscriptionInput, PushSubscription } from "./domain/push-subscription.js";
export type { Notification, NotificationStatus } from "./domain/notification.js";
export type { Mailer, PushSender } from "./application/ports.js";
export { SmtpMailer } from "./infrastructure/mailer-smtp.js";
export { WebPushSender } from "./infrastructure/push-sender.js";

export interface NotificationsModuleDeps {
  db: Kysely<Database>;
  users: UsersModule;
  clock: Clock;
  mailer: Mailer;
  pushSender: PushSender;
}

function buildDeps(deps: { db: Kysely<Database>; users: UsersModule; clock: Clock; mailer: Mailer; pushSender: PushSender }): NotificationsDeps<Kysely<Database>> {
  return {
    preferencesRepo: new KyselyPreferencesRepository(),
    pushSubscriptionsRepo: new KyselyPushSubscriptionsRepository(),
    notificationsRepo: new KyselyNotificationsRepository(),
    users: { byId: deps.users.byId },
    mailer: deps.mailer,
    pushSender: deps.pushSender,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };
}

export interface NotificationsModule {
  router: Router;
  // API pública para `alerts` consumir pela raiz (modules.md §2 nota 15) — processo "worker".
  isTypeEnabled: (trx: Kysely<Database>, userId: string, type: AlertNotificationType) => Promise<boolean>;
  enqueueForAlert: (trx: Kysely<Database>, input: EnqueueForAlertInput) => Promise<void>;
  skipPendingForAlert: (trx: Kysely<Database>, alertId: string) => Promise<void>;
}

/** Composition root do processo "api" (main/api.ts). */
export function createNotificationsModule(deps: NotificationsModuleDeps): NotificationsModule {
  const notificationsDeps = buildDeps(deps);

  const controller: NotificationsController = {
    getPreferences: createGetPreferencesUseCase(notificationsDeps),
    putPreferences: createPutPreferencesUseCase(notificationsDeps),
    addPushSubscription: createAddPushSubscriptionUseCase(notificationsDeps),
    deletePushSubscription: createDeletePushSubscriptionUseCase(notificationsDeps),
  };

  return {
    router: createNotificationsRouter(controller),
    isTypeEnabled: createIsTypeEnabledUseCase(notificationsDeps),
    enqueueForAlert: createEnqueueForAlertUseCase(notificationsDeps),
    skipPendingForAlert: createSkipPendingForAlertUseCase(notificationsDeps),
  };
}

export interface NotificationsWorkerModuleDeps {
  db: Kysely<Database>;
  users: UsersModule;
  clock: Clock;
  mailer: Mailer;
  pushSender: PushSender;
  boss: PgBoss;
}

export interface NotificationsWorkerModule {
  /** Regista `notifications.send` (1 min, modules.md §5). */
  registerWorkers: () => Promise<string[]>;
  // Mesma API pública que a variante "api" (`alerts.scan` corre no processo "worker").
  isTypeEnabled: (trx: Kysely<Database>, userId: string, type: AlertNotificationType) => Promise<boolean>;
  enqueueForAlert: (trx: Kysely<Database>, input: EnqueueForAlertInput) => Promise<void>;
  skipPendingForAlert: (trx: Kysely<Database>, alertId: string) => Promise<void>;
}

/** Composition root do processo "worker" (main/worker.ts). */
export function createNotificationsWorkerModule(deps: NotificationsWorkerModuleDeps): NotificationsWorkerModule {
  const notificationsDeps: NotificationsWorkerDeps<Kysely<Database>> = buildDeps(deps);
  const sendJob = createSendJobUseCase(notificationsDeps);

  return {
    registerWorkers: async () => [await registerSendWorker(deps.boss, sendJob)],
    isTypeEnabled: createIsTypeEnabledUseCase(notificationsDeps),
    enqueueForAlert: createEnqueueForAlertUseCase(notificationsDeps),
    skipPendingForAlert: createSkipPendingForAlertUseCase(notificationsDeps),
  };
}
