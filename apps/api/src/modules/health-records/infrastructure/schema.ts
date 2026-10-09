// Fusão de declaração das tabelas `allergies`, `medical_conditions` (schema.md §3) no `Database`
// partilhado — só a infrastructure deste módulo acede a estas tabelas (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface AllergiesTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  name: string;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  since: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface MedicalConditionsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  name: string;
  kind: "CONDITION" | "HISTORY";
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  since: ColumnType<string | null, string | null | undefined, string | null>;
  until: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    allergies: AllergiesTable;
    medical_conditions: MedicalConditionsTable;
  }
}
