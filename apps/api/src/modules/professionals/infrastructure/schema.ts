// Fusão de declaração das tabelas de `professionals` (schema.md §11, migração 0043) no `Database` partilhado — só a infrastructure
// deste módulo acede a estas tabelas.
import type { ColumnType } from "kysely";

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

declare module "../../../platform/db/index.js" {
  interface Database {
    professional_accounts: ProfessionalAccountsTable;
    professional_auth_tokens: ProfessionalAuthTokensTable;
    professional_sessions: ProfessionalSessionsTable;
    professionals: ProfessionalsTable;
  }
}

