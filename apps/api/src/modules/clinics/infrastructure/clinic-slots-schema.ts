// Fusão de declaração da tabela `clinic_slots` (schema.md §3 v0.2, Fase C) no `Database`
// partilhado — só a infrastructure deste módulo acede a esta tabela.
import type { ColumnType, Generated } from "kysely";

export interface ClinicSlotsTable {
  id: Generated<string>;
  clinic_id: string;
  specialty: string;
  professional_name: string | null;
  starts_at: ColumnType<Date, Date, never>;
  duration_minutes: number;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    clinic_slots: ClinicSlotsTable;
  }
}
