// Implementação Kysely/pg das portas de `notifications` (application/ports.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { Channel, NotificationPreference } from "../domain/preference.js";
import type { NewPushSubscriptionInput, PushSubscription } from "../domain/push-subscription.js";
import type { Notification, NotificationStatus } from "../domain/notification.js";
import type { NewNotificationRecord, NotificationsRepository, PreferencesRepository, PushSubscriptionsRepository } from "../application/ports.js";
import "./schema.js";

interface PreferenceRow {
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  medication_due: boolean;
  appointment_reminder: boolean;
  exam_reminder: boolean;
}

function toPreference(row: PreferenceRow): NotificationPreference {
  return {
    userId: row.user_id,
    pushEnabled: row.push_enabled,
    emailEnabled: row.email_enabled,
    medicationDue: row.medication_due,
    appointmentReminder: row.appointment_reminder,
    examReminder: row.exam_reminder,
  };
}

const PREFERENCE_COLUMNS = ["user_id", "push_enabled", "email_enabled", "medication_due", "appointment_reminder", "exam_reminder"] as const;

export class KyselyPreferencesRepository implements PreferencesRepository<Kysely<Database>> {
  async findByUserId(trx: Kysely<Database>, userId: string): Promise<NotificationPreference | null> {
    const row = await trx.selectFrom("notification_preferences").select(PREFERENCE_COLUMNS).where("user_id", "=", userId).executeTakeFirst();
    return row ? toPreference(row) : null;
  }

  async upsert(trx: Kysely<Database>, preference: NotificationPreference): Promise<NotificationPreference> {
    const row = await trx
      .insertInto("notification_preferences")
      .values({
        user_id: preference.userId,
        push_enabled: preference.pushEnabled,
        email_enabled: preference.emailEnabled,
        medication_due: preference.medicationDue,
        appointment_reminder: preference.appointmentReminder,
        exam_reminder: preference.examReminder,
      })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({
          push_enabled: (eb) => eb.ref("excluded.push_enabled"),
          email_enabled: (eb) => eb.ref("excluded.email_enabled"),
          medication_due: (eb) => eb.ref("excluded.medication_due"),
          appointment_reminder: (eb) => eb.ref("excluded.appointment_reminder"),
          exam_reminder: (eb) => eb.ref("excluded.exam_reminder"),
          updated_at: sql`now()`,
        }),
      )
      .returning(PREFERENCE_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPreference(row);
  }
}

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  last_success_at: Date | null;
  created_at: Date;
}

function toPushSubscription(row: PushSubscriptionRow): PushSubscription {
  const subscription: PushSubscription = {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.created_at,
  };
  if (row.user_agent !== null) subscription.userAgent = row.user_agent;
  if (row.last_success_at !== null) subscription.lastSuccessAt = row.last_success_at;
  return subscription;
}

const PUSH_SUBSCRIPTION_COLUMNS = ["id", "user_id", "endpoint", "p256dh", "auth", "user_agent", "last_success_at", "created_at"] as const;

export class KyselyPushSubscriptionsRepository implements PushSubscriptionsRepository<Kysely<Database>> {
  async listByUserId(trx: Kysely<Database>, userId: string): Promise<PushSubscription[]> {
    const rows = await trx.selectFrom("push_subscriptions").select(PUSH_SUBSCRIPTION_COLUMNS).where("user_id", "=", userId).execute();
    return rows.map(toPushSubscription);
  }

  async findByEndpoint(trx: Kysely<Database>, endpoint: string): Promise<PushSubscription | null> {
    const row = await trx.selectFrom("push_subscriptions").select(PUSH_SUBSCRIPTION_COLUMNS).where("endpoint", "=", endpoint).executeTakeFirst();
    return row ? toPushSubscription(row) : null;
  }

  async upsert(trx: Kysely<Database>, input: NewPushSubscriptionInput, id: string, createdAt: Date): Promise<PushSubscription> {
    // UC-ALR-06: "endpoint repetido atualiza a existente" — `endpoint` é UNIQUE (schema.md §1).
    const row = await trx
      .insertInto("push_subscriptions")
      .values({
        id,
        user_id: input.userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        user_agent: input.userAgent ?? null,
        created_at: createdAt,
      })
      .onConflict((oc) =>
        oc.column("endpoint").doUpdateSet({
          user_id: (eb) => eb.ref("excluded.user_id"),
          p256dh: (eb) => eb.ref("excluded.p256dh"),
          auth: (eb) => eb.ref("excluded.auth"),
          user_agent: (eb) => eb.ref("excluded.user_agent"),
          updated_at: sql`now()`,
        }),
      )
      .returning(PUSH_SUBSCRIPTION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPushSubscription(row);
  }

  async delete(trx: Kysely<Database>, userId: string, id: string): Promise<void> {
    await trx.deleteFrom("push_subscriptions").where("user_id", "=", userId).where("id", "=", id).execute();
  }

  async markSuccess(trx: Kysely<Database>, id: string, at: Date): Promise<void> {
    await trx.updateTable("push_subscriptions").set({ last_success_at: at, updated_at: sql`now()` }).where("id", "=", id).execute();
  }

  async deleteByEndpoint(trx: Kysely<Database>, endpoint: string): Promise<void> {
    await trx.deleteFrom("push_subscriptions").where("endpoint", "=", endpoint).execute();
  }
}

interface NotificationRow {
  id: string;
  alert_id: string;
  recipient_user_id: string;
  channel: Channel;
  status: NotificationStatus;
  attempts: number;
  next_attempt_at: Date | null;
  last_error_code: string | null;
  sent_at: Date | null;
  created_at: Date;
}

function toNotification(row: NotificationRow): Notification {
  const notification: Notification = {
    id: row.id,
    alertId: row.alert_id,
    recipientUserId: row.recipient_user_id,
    channel: row.channel,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
  };
  if (row.next_attempt_at !== null) notification.nextAttemptAt = row.next_attempt_at;
  if (row.last_error_code !== null) notification.lastErrorCode = row.last_error_code;
  if (row.sent_at !== null) notification.sentAt = row.sent_at;
  return notification;
}

const NOTIFICATION_COLUMNS = ["id", "alert_id", "recipient_user_id", "channel", "status", "attempts", "next_attempt_at", "last_error_code", "sent_at", "created_at"] as const;

export class KyselyNotificationsRepository implements NotificationsRepository<Kysely<Database>> {
  async insertIfNew(trx: Kysely<Database>, record: NewNotificationRecord): Promise<Notification | null> {
    const row = await trx
      .insertInto("notifications")
      .values({
        id: record.id,
        alert_id: record.alertId,
        recipient_user_id: record.recipientUserId,
        channel: record.channel,
        status: "PENDING" as const,
        attempts: 0,
        created_at: record.createdAt,
      })
      // schema.md §4: UNIQUE (alert_id, channel) — idempotente (ADR-009).
      .onConflict((oc) => oc.columns(["alert_id", "channel"]).doNothing())
      .returning(NOTIFICATION_COLUMNS)
      .executeTakeFirst();
    return row ? toNotification(row) : null;
  }

  async listDueForSending(trx: Kysely<Database>, now: Date, limit: number): Promise<Notification[]> {
    // indexes.md: `(status, next_attempt_at) WHERE status IN ('PENDING','FAILED')`. `PENDING`
    // nunca tem `next_attempt_at` (primeira tentativa, imediata); `FAILED` terminal (`attempts`
    // esgotados) fica com `next_attempt_at` nulo — `NULL <= now` é falso em SQL, por isso nunca é
    // reselecionado (sem precisar de outra coluna/estado).
    const rows = await trx
      .selectFrom("notifications")
      .select(NOTIFICATION_COLUMNS)
      .where((eb) => eb.or([eb("status", "=", "PENDING"), eb.and([eb("status", "=", "FAILED"), eb("next_attempt_at", "<=", now)])]))
      .orderBy("created_at", "asc")
      .limit(limit)
      .execute();
    return rows.map(toNotification);
  }

  async markSent(trx: Kysely<Database>, id: string, sentAt: Date): Promise<void> {
    await trx.updateTable("notifications").set({ status: "SENT", sent_at: sentAt, updated_at: sql`now()` }).where("id", "=", id).execute();
  }

  async markSkipped(trx: Kysely<Database>, id: string, reasonCode: string): Promise<void> {
    await trx.updateTable("notifications").set({ status: "SKIPPED", last_error_code: reasonCode, updated_at: sql`now()` }).where("id", "=", id).execute();
  }

  async markRetry(trx: Kysely<Database>, id: string, attempts: number, nextAttemptAt: Date, errorCode: string): Promise<void> {
    await trx
      .updateTable("notifications")
      .set({ status: "FAILED", attempts, next_attempt_at: nextAttemptAt, last_error_code: errorCode, updated_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }

  async markFailedTerminal(trx: Kysely<Database>, id: string, attempts: number, errorCode: string): Promise<void> {
    await trx
      .updateTable("notifications")
      .set({ status: "FAILED", attempts, next_attempt_at: null, last_error_code: errorCode, updated_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }

  async skipPendingByAlertId(trx: Kysely<Database>, alertId: string): Promise<void> {
    await trx
      .updateTable("notifications")
      .set({ status: "SKIPPED", last_error_code: "ALERT_READ", updated_at: sql`now()` })
      .where("alert_id", "=", alertId)
      .where("status", "in", ["PENDING", "FAILED"])
      .execute();
  }
}
