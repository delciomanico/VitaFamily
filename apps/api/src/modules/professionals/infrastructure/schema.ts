// Fusão de declaração das tabelas de `professionals` (schema.md §11, migração 0043) no `Database` partilhado — só a infrastructure
// deste módulo acede a estas tabelas.
import type { ColumnType } from "kysely";

type SpecialtyCategoryValue = "HEALTH" | "WELLNESS";
type ProfessionalStatus = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
type Timestamp = ColumnType<Date, Date | undefined, Date>;
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface ProfessionalAccountsTable {
  id: string;
  email: string;
  password_hash: string;
  status: ColumnType<"PENDING_VERIFICATION" | "ACTIVE", "PENDING_VERIFICATION" | "ACTIVE" | undefined, "PENDING_VERIFICATION" | "ACTIVE">;
  email_verified_at: Nullable<Date>;
  terms_accepted_version: string;
  terms_accepted_at: Date;
  last_login_at: Nullable<Date>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProfessionalAuthTokensTable {
  id: string;
  account_id: string;
  type: "EMAIL_VERIFICATION" | "PASSWORD_RESET";
  token_hash: string;
  expires_at: Date;
  used_at: Nullable<Date>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProfessionalSessionsTable {
  id: string;
  account_id: string;
  refresh_token_hash: string;
  token_chain_id: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: Date;
  revoked_at: Nullable<Date>;
  last_used_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProfessionalsTable {
  id: string;
  account_id: string;
  display_name: Nullable<string>;
  bio: Nullable<string>;
  city: Nullable<string>;
  payment_instructions: Nullable<string>;
  validation_status: ColumnType<ProfessionalStatus, ProfessionalStatus | undefined, ProfessionalStatus>;
  status_reason: Nullable<string>;
  status_changed_at: Timestamp;
  submitted_at: Nullable<Date>;
  approved_at: Nullable<Date>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SpecialtiesTable {
  id: string;
  name: string;
  category: SpecialtyCategoryValue;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProfessionalSpecialtiesTable {
  professional_id: string;
  specialty_id: string;
  created_at: Timestamp;
}

export interface ProfessionalCredentialsTable {
  id: string;
  professional_id: string;
  kind: "IDENTITY" | "PROFESSIONAL_LICENSE" | "CERTIFICATION";
  number: Nullable<string>;
  issuing_body: Nullable<string>;
  valid_until: Nullable<string>;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  scan_status: ColumnType<"PENDING" | "CLEAN" | "INFECTED", "PENDING" | "CLEAN" | "INFECTED" | undefined, "PENDING" | "CLEAN" | "INFECTED">;
  scanned_at: Nullable<Date>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ValidationCasesTable {
  id: string;
  professional_id: string;
  action: "SUBMITTED" | "APPROVED" | "REJECTED" | "NEEDS_INFO" | "SUSPENDED" | "REACTIVATED" | "EXPIRED";
  from_status: ProfessionalStatus;
  to_status: ProfessionalStatus;
  actor: "PROFESSIONAL" | "PLATFORM_ADMIN" | "SYSTEM";
  decided_by: string | null;
  reason: string | null;
  created_at: Timestamp;
}

export interface ProfessionalOffersTable {
  id: string;
  professional_id: string;
  specialty_id: string;
  method: "IN_PERSON" | "VIDEO" | "CHAT" | "PHONE";
  duration_minutes: number;
  price_kz: number;
  note: Nullable<string>;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProfessionalScheduleRulesTable {
  id: string;
  professional_id: string;
  offer_id: string;
  weekdays: number[];
  start_time: string;
  end_time: string;
  valid_from: Nullable<string>;
  valid_until: Nullable<string>;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProfessionalTimeOffTable {
  id: string;
  professional_id: string;
  starts_at: Date;
  ends_at: Date;
  reason: Nullable<string>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProfessionalSlotsTable {
  id: string;
  professional_id: string;
  offer_id: string;
  rule_id: string;
  starts_at: Date;
  ends_at: Date;
  created_at: Timestamp;
  updated_at: Timestamp;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    professional_accounts: ProfessionalAccountsTable;
    professional_auth_tokens: ProfessionalAuthTokensTable;
    professional_sessions: ProfessionalSessionsTable;
    professionals: ProfessionalsTable;
    specialties: SpecialtiesTable;
    professional_specialties: ProfessionalSpecialtiesTable;
    professional_credentials: ProfessionalCredentialsTable;
    validation_cases: ValidationCasesTable;
    professional_offers: ProfessionalOffersTable;
    professional_schedule_rules: ProfessionalScheduleRulesTable;
    professional_time_off: ProfessionalTimeOffTable;
    professional_slots: ProfessionalSlotsTable;
  }
}

