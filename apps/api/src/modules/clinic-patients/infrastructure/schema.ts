// Fusão de declaração das tabelas de `db/migrations/0028_clinic_patients.sql` (schema.md §3d) no `Database`
// partilhado — só a infrastructure deste módulo acede a estas tabelas (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface ClinicPatientsTable {
  id: Generated<string>;
  clinic_id: string;
  name: string;
  name_norm: string;
  phone: Nullable<string>;
  phone_digits: Nullable<string>;
  email: Nullable<string>;
  birth_date: ColumnType<string | null, string | null | undefined, string | null>;
  notes: Nullable<string>;
  origin: "MANUAL" | "VITA";
  created_by_clinic_account_id: Nullable<string>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ClinicPatientLinksTable {
  id: Generated<string>;
  clinic_id: string;
  clinic_patient_id: string;
  family_id: string;
  member_id: string;
  via: "EMAIL" | "CODE";
  created_at: ColumnType<Date, Date | undefined, never>;
}

export interface ClinicConsentsTable {
  id: Generated<string>;
  clinic_id: string;
  family_id: string;
  member_id: string;
  level: "BOOKINGS" | "HISTORY";
  history_valid_until: Nullable<Date>;
  granted_by_user_id: Nullable<string>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ClinicLinkCodesTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  code_hash: string;
  expires_at: Date;
  used_at: Nullable<Date>;
  created_by_user_id: Nullable<string>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

export interface ClinicVisitsTable {
  id: Generated<string>;
  clinic_id: string;
  clinic_patient_id: string;
  slot_id: Nullable<string>;
  scheduled_at: Date;
  duration_minutes: number;
  status: ColumnType<"SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW", "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW" | undefined, "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW">;
  notes: Nullable<string>;
  outcome_note: Nullable<string>;
  cancel_note: Nullable<string>;
  booked_by_clinic_account_id: Nullable<string>;
  /** M14 Q (BR-CLN-25/28/30) — `db/migrations/0029_clinic_day_flow.sql`; visitas nunca `DECLINED`, origem sempre `CLINIC`. */
  confirmation_status: ColumnType<"PENDING" | "CONFIRMED", "PENDING" | "CONFIRMED" | undefined, "PENDING" | "CONFIRMED">;
  confirmation_source: Nullable<"CLINIC">;
  confirmed_at: Nullable<Date>;
  arrived_at: Nullable<Date>;
  started_at: Nullable<Date>;
  followup_due_on: Nullable<string>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    clinic_patients: ClinicPatientsTable;
    clinic_patient_links: ClinicPatientLinksTable;
    clinic_consents: ClinicConsentsTable;
    clinic_link_codes: ClinicLinkCodesTable;
    clinic_visits: ClinicVisitsTable;
  }
}
