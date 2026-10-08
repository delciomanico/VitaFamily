// Fusão de declaração das tabelas `users` e `notification_preferences` (schema.md §1) no
// `Database` partilhado — só a infrastructure deste módulo acede a estas tabelas.
import type { ColumnType, Generated } from "kysely";

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  name: string;
  birth_date: ColumnType<string, string, string>;
  timezone: string;
  status: Generated<"PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED">;
  platform_role: Generated<"NONE" | "PLATFORM_ADMIN">;
  email_verified_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  terms_accepted_version: string;
  terms_accepted_at: ColumnType<Date, Date, Date>;
  suspended_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  suspension_reason: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface NotificationPreferencesTable {
  id: Generated<string>;
  user_id: string;
  push_enabled: Generated<boolean>;
  email_enabled: Generated<boolean>;
  medication_due: Generated<boolean>;
  appointment_reminder: Generated<boolean>;
  exam_reminder: Generated<boolean>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    users: UsersTable;
    notification_preferences: NotificationPreferencesTable;
  }
}
