// Fusão de declaração da tabela `alerts` (schema.md §4) no `Database` partilhado — só a
// infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface AlertsTable {
  id: Generated<string>;
  recipient_user_id: string;
  family_id: string;
  member_id: string;
  type: "MEDICATION_DUE" | "APPOINTMENT_REMINDER" | "EXAM_REMINDER" | "APPOINTMENT_OUTCOME_REQUEST";
  source_type: "DOSE" | "APPOINTMENT" | "EXAMINATION";
  source_id: string;
  rule_key: string;
  dedupe_key: string;
  trigger_at: ColumnType<Date, Date, never>;
  read_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    alerts: AlertsTable;
  }
}
