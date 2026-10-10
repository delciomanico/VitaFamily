// Fusão de declaração da tabela `appointments` (schema.md §3) no `Database` partilhado — só a
// infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface AppointmentsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  scheduled_at: Date;
  status: "SCHEDULED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  professional_name: ColumnType<string | null, string | null | undefined, string | null>;
  clinic_id: ColumnType<string | null, string | null | undefined, string | null>;
  clinic_name: ColumnType<string | null, string | null | undefined, string | null>;
  reason: ColumnType<string | null, string | null | undefined, string | null>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  outcome_requested_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    appointments: AppointmentsTable;
  }
}
