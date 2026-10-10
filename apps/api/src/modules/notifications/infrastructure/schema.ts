// Fusão de declaração das tabelas `notification_preferences`, `push_subscriptions`,
// `notifications` (schema.md §1/§4 + `recipient_user_id` desnormalizado, ver
// `domain/notification.ts`/`README.md`) no `Database` partilhado — só a infrastructure deste
// módulo acede a estas tabelas (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface NotificationPreferencesTable {
  id: Generated<string>;
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  medication_due: boolean;
  appointment_reminder: boolean;
  exam_reminder: boolean;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface PushSubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: ColumnType<string | null, string | null | undefined, string | null>;
  last_success_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  alert_id: string;
  recipient_user_id: string;
  channel: "PUSH" | "EMAIL";
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempts: number;
  next_attempt_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  last_error_code: ColumnType<string | null, string | null | undefined, string | null>;
  sent_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    notification_preferences: NotificationPreferencesTable;
    push_subscriptions: PushSubscriptionsTable;
    notifications: NotificationsTable;
  }
}
