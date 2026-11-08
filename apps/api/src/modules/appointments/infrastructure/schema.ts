// Fusão de declaração da tabela `appointments` (schema.md §3) no `Database` partilhado — só a
// infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface AppointmentsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  scheduled_at: Date;
  status: "REQUESTED" | "SCHEDULED" | "REJECTED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  professional_name: ColumnType<string | null, string | null | undefined, string | null>;
  clinic_id: ColumnType<string | null, string | null | undefined, string | null>;
  clinic_name: ColumnType<string | null, string | null | undefined, string | null>;
  specialty: ColumnType<string | null, string | null | undefined, string | null>;
  reason: ColumnType<string | null, string | null | undefined, string | null>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  outcome_requested_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  /** Horário de clínica parceira de origem (D17) — `db/migrations/0016_appointment_slot_booking.sql`. */
  slot_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Motivo da clínica ao recusar/cancelar (D17). */
  response_note: ColumnType<string | null, string | null | undefined, string | null>;
  /** Resultado da consulta registado pela clínica (D18) — `db/migrations/0017_*.sql`. */
  clinic_outcome_note: ColumnType<string | null, string | null | undefined, string | null>;
  outcome_recorded_by_clinic_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  outcome_recorded_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  /** Marcada presencialmente pela clínica (D20, ADR-024) — `db/migrations/0026_appointment_walk_in.sql`; permanente. */
  walk_in: ColumnType<boolean, boolean | undefined, boolean>;
  booked_by_clinic_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** BR-CLN-16 — `db/migrations/0027_clinic_catalog_schedule.sql`; default 30. */
  duration_minutes: ColumnType<number, number | undefined, number>;
  /** M14 Q (BR-CLN-25/28/30) — `db/migrations/0029_clinic_day_flow.sql`. */
  confirmation_status: ColumnType<"PENDING" | "CONFIRMED" | "DECLINED", "PENDING" | "CONFIRMED" | "DECLINED" | undefined, "PENDING" | "CONFIRMED" | "DECLINED">;
  confirmation_source: ColumnType<"PATIENT" | "CLINIC" | null, "PATIENT" | "CLINIC" | null | undefined, "PATIENT" | "CLINIC" | null>;
  confirmed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  arrived_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  started_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  followup_due_on: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    appointments: AppointmentsTable;
  }
}
