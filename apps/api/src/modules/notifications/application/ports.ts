// Portas do módulo `notifications` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg, nodemailer, web-push) ou ligadas à raiz a partir da API pública de
// `users` (modules.md §2: `notifications` depende só de `users`). Genéricas em `Trx` para que
// esta camada nunca importe "kysely"/"nodemailer"/"web-push" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { Channel, NotificationPreference } from "../domain/preference.js";
import type { NewPushSubscriptionInput, PushSubscription } from "../domain/push-subscription.js";
import type { Notification, NotificationStatus } from "../domain/notification.js";

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

/** Subconjunto da API pública de `users` (modules.md §2) — só o necessário para decidir SKIPPED
 * por conta suspensa (`UserStatus`, entities.md). */
export interface UsersPort<Trx> {
  byId(trx: Trx, id: string): Promise<{ id: string; status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED"; email: string; name: string } | null>;
}

/** `notification_preferences` (schema.md §1) — propriedade exclusiva deste módulo (conventions.md §3.5). */
export interface PreferencesRepository<Trx> {
  findByUserId(trx: Trx, userId: string): Promise<NotificationPreference | null>;
  upsert(trx: Trx, preference: NotificationPreference): Promise<NotificationPreference>;
}

/** `push_subscriptions` (schema.md §1) — propriedade exclusiva deste módulo. */
export interface PushSubscriptionsRepository<Trx> {
  listByUserId(trx: Trx, userId: string): Promise<PushSubscription[]>;
  findByEndpoint(trx: Trx, endpoint: string): Promise<PushSubscription | null>;
  /** UC-ALR-06: registar; endpoint repetido atualiza a subscrição existente (upsert por `endpoint`). */
  upsert(trx: Trx, input: NewPushSubscriptionInput, id: string, createdAt: Date): Promise<PushSubscription>;
  delete(trx: Trx, userId: string, id: string): Promise<void>;
  markSuccess(trx: Trx, id: string, at: Date): Promise<void>;
  /** state-machines.md "Notification" SKIPPED ("sem subscrição push"): remove subscrições
   * inválidas/expiradas devolvidas pelo fornecedor Web Push (UC-ALR-06: "regra"). */
  deleteByEndpoint(trx: Trx, endpoint: string): Promise<void>;
}

export interface NewNotificationRecord {
  id: string;
  alertId: string;
  recipientUserId: string;
  channel: Channel;
  createdAt: Date;
}

/** `notifications` (schema.md §4 + `recipient_user_id` desnormalizado, ver `domain/notification.ts`
 * e `README.md`) — propriedade exclusiva deste módulo. */
export interface NotificationsRepository<Trx> {
  /** `alerts.scan` chama `enqueueForAlert` (application) uma vez por canal ativo — `UNIQUE
   * (alert_id, channel)` (schema.md §4) torna este insert idempotente (ON CONFLICT DO NOTHING). */
  insertIfNew(trx: Trx, record: NewNotificationRecord): Promise<Notification | null>;
  /** `notifications.send` (scanner, modules.md §5): `PENDING` (sempre) ou `FAILED` com
   * `next_attempt_at <= now` (ST6) — nunca `FAILED` terminal (`next_attempt_at` nulo). */
  listDueForSending(trx: Trx, now: Date, limit: number): Promise<Notification[]>;
  markSent(trx: Trx, id: string, sentAt: Date): Promise<void>;
  markSkipped(trx: Trx, id: string, reasonCode: string): Promise<void>;
  markRetry(trx: Trx, id: string, attempts: number, nextAttemptAt: Date, errorCode: string): Promise<void>;
  markFailedTerminal(trx: Trx, id: string, attempts: number, errorCode: string): Promise<void>;
  /** `alerts.markAlertRead` chama `skipPendingForAlert` (application, modules.md §2 nota 15):
   * marca `SKIPPED` as notificações ainda não enviadas de um alerta lido antes do envio
   * (state-machines.md "Notification" SKIPPED). */
  skipPendingByAlertId(trx: Trx, alertId: string): Promise<void>;
  countByStatus?(trx: Trx, status: NotificationStatus): Promise<number>;
}

/** Porta de envio por e-mail (conventions.md §2: "E-mail / push: portas Mailer, PushSender"). */
export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** Porta de envio Web Push (VAPID) — `PushSendResult.invalidSubscription` sinaliza 404/410 do
 * fornecedor (endpoint expirado/revogado), para remoção (UC-ALR-06: "regra"). */
export interface PushSendResult {
  delivered: boolean;
  invalidSubscription?: boolean;
  errorCode?: string;
}

export interface PushSender {
  send(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<PushSendResult>;
}

export interface NotificationsDeps<Trx> {
  preferencesRepo: PreferencesRepository<Trx>;
  pushSubscriptionsRepo: PushSubscriptionsRepository<Trx>;
  notificationsRepo: NotificationsRepository<Trx>;
  users: UsersPort<Trx>;
  mailer: Mailer;
  pushSender: PushSender;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

/** Subconjunto para o processo "worker" (`notifications.send`, modules.md §5) — sem HTTP. */
export type NotificationsWorkerDeps<Trx> = Pick<
  NotificationsDeps<Trx>,
  "notificationsRepo" | "preferencesRepo" | "pushSubscriptionsRepo" | "users" | "mailer" | "pushSender" | "withTransaction" | "clock"
>;

export type { AlertNotificationType, Channel, NotificationPreference, NotificationPreferenceChanges } from "../domain/preference.js";
export type { NewPushSubscriptionInput, PushSubscription } from "../domain/push-subscription.js";
export type { Notification, NotificationStatus } from "../domain/notification.js";
