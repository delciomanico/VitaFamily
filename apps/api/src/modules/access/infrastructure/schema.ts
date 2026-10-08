// Fusão de declaração da tabela `sharing_grants` (schema.md §2) no `Database` partilhado — só a
// infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface SharingGrantsTable {
  id: Generated<string>;
  family_id: string;
  owner_member_id: string;
  grantee_member_id: ColumnType<string | null, string | null | undefined, string | null>;
  category: "ALLERGIES" | "CONDITIONS" | "MEDICATION" | "APPOINTMENTS" | "EXAMS";
  granted_by: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    sharing_grants: SharingGrantsTable;
  }
}
