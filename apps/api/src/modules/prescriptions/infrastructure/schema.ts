// Fusão de declaração da tabela `prescriptions` (schema.md §3) no `Database` partilhado — só a
// infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface PrescriptionsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  issued_on: string;
  doctor_name: ColumnType<string | null, string | null | undefined, string | null>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    prescriptions: PrescriptionsTable;
  }
}
