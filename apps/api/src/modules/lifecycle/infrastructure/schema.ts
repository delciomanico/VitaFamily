// Fusão de declaração da tabela `data_exports` (schema.md §5, db/migrations/0011_data_exports.sql)
// no `Database` partilhado — só a infrastructure deste módulo acede a esta tabela.
import type { ColumnType, Generated } from "kysely";

export interface DataExportsTable {
  id: Generated<string>;
  requested_by: string;
  family_id: string | null;
  subject_member_id: string | null;
  reason: "USER_REQUEST" | "LEAVE_FAMILY" | "REMOVED_BY_ADMIN";
  status: ColumnType<"PENDING" | "READY" | "EXPIRED" | "FAILED", "PENDING" | "READY" | "EXPIRED" | "FAILED" | undefined, "PENDING" | "READY" | "EXPIRED" | "FAILED">;
  storage_key: ColumnType<string | null, string | null | undefined, string | null>;
  expires_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    data_exports: DataExportsTable;
  }
}
