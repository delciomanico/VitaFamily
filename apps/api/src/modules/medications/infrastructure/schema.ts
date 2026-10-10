// Fusão de declaração das tabelas `medication_plans`, `dose_occurrences` (schema.md §3) no
// `Database` partilhado — só a infrastructure deste módulo acede a estas tabelas (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface MedicationPlansTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  prescription_id: ColumnType<string | null, string | null | undefined, string | null>;
  name: string;
  dosage: string;
  schedule_type: "FIXED_TIMES" | "INTERVAL";
  times: ColumnType<string[] | null, string[] | null | undefined, string[] | null>;
  days_of_week: ColumnType<number[] | null, number[] | null | undefined, number[] | null>;
  interval_hours: ColumnType<number | null, number | null | undefined, number | null>;
  start_at: ColumnType<Date, Date, never>;
  end_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  continuous: boolean;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  status: "ACTIVE" | "ENDED";
  ended_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface DoseOccurrencesTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  plan_id: string;
  scheduled_at: ColumnType<Date, Date, never>;
  status: "PENDING" | "TAKEN" | "NOT_TAKEN" | "UNCONFIRMED";
  acted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  acted_by_user_id: ColumnType<string | null, string | null | undefined, string | null>;
  note: ColumnType<string | null, string | null | undefined, string | null>;
  generation_version: number;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    medication_plans: MedicationPlansTable;
    dose_occurrences: DoseOccurrencesTable;
  }
}
