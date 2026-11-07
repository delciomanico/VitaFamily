// Fusão de declaração da tabela `clinics` (schema.md §3) no `Database` partilhado — só a
// infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface ClinicsTable {
  id: Generated<string>;
  type: "PARTNER" | "PRIVATE";
  family_id: string | null;
  name: string;
  address: ColumnType<string | null, string | null | undefined, string | null>;
  phone: ColumnType<string | null, string | null | undefined, string | null>;
  email: ColumnType<string | null, string | null | undefined, string | null>;
  /** M14 a1 (`0027`): moeda da clínica, só leitura nestas fases. */
  currency: ColumnType<string, string | undefined, never>;
  status: "ACTIVE" | "ARCHIVED";
  created_by: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    clinics: ClinicsTable;
  }
}
