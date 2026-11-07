// Fusão de declaração da tabela `clinic_slots` (schema.md §3 v0.2, Fase C) no `Database`
// partilhado — só a infrastructure deste módulo acede a esta tabela.
import type { ColumnType, Generated } from "kysely";

export interface ClinicSlotsTable {
  id: Generated<string>;
  clinic_id: string;
  /** D19 (BR-APT-10) — `db/migrations/0021_clinic_exams.sql`; default `APPOINTMENT`. */
  kind: ColumnType<"APPOINTMENT" | "EXAM", "APPOINTMENT" | "EXAM" | undefined, never>;
  specialty: string;
  professional_name: string | null;
  starts_at: ColumnType<Date, Date, never>;
  duration_minutes: number;
  /** BR-APT-11 — `db/migrations/0022_exam_slot_capacity_and_issuer_checks.sql`; default 1. */
  capacity: ColumnType<number, number | undefined, number>;
  /** M14 a1/a2 — `db/migrations/0027_clinic_catalog_schedule.sql`; mantida pelo repositório (`starts_at + duração`). */
  professional_id: ColumnType<string | null, string | null | undefined, string | null>;
  service_type_id: ColumnType<string | null, string | null | undefined, string | null>;
  schedule_rule_id: ColumnType<string | null, string | null | undefined, string | null>;
  ends_at: ColumnType<Date, Date, never>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    clinic_slots: ClinicSlotsTable;
  }
}
