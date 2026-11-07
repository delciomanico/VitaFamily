// Fusão de declaração das tabelas do catálogo/regras/bloqueios (schema.md §3a, M14 a1/a2,
// `db/migrations/0027_clinic_catalog_schedule.sql`) no `Database` partilhado — só a infrastructure deste
// módulo acede a estas tabelas.
import type { ColumnType, Generated } from "kysely";

export interface ClinicProfessionalsTable {
  id: Generated<string>;
  clinic_id: string;
  name: string;
  specialty: string | null;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ClinicServiceTypesTable {
  id: Generated<string>;
  clinic_id: string;
  name: string;
  kind: ColumnType<"APPOINTMENT" | "EXAM", "APPOINTMENT" | "EXAM", never>;
  duration_minutes: number;
  /** `bigint`: o `pg` devolve texto. */
  price_minor: ColumnType<string | null, number | null | undefined, number | null>;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ClinicScheduleRulesTable {
  id: Generated<string>;
  clinic_id: string;
  professional_id: ColumnType<string, string, never>;
  service_type_id: ColumnType<string, string, never>;
  weekdays: number[];
  start_time: string;
  end_time: string;
  valid_from: ColumnType<string | null, string | null | undefined, string | null>;
  valid_until: ColumnType<string | null, string | null | undefined, string | null>;
  capacity: number;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ClinicTimeOffTable {
  id: Generated<string>;
  clinic_id: string;
  professional_id: ColumnType<string, string, never>;
  starts_at: ColumnType<Date, Date, never>;
  ends_at: ColumnType<Date, Date, never>;
  reason: string | null;
  created_by_clinic_account_id: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    clinic_professionals: ClinicProfessionalsTable;
    clinic_service_types: ClinicServiceTypesTable;
    clinic_schedule_rules: ClinicScheduleRulesTable;
    clinic_time_off: ClinicTimeOffTable;
  }
}
