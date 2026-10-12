// Fusão de declaração das tabelas `clinic_accounts` e `clinic_sessions` (schema.md §1, ADR-020) no
// `Database` partilhado — só a infrastructure deste módulo acede a estas tabelas.
import type { ColumnType, Generated } from "kysely";

export interface ClinicAccountsTable {
  id: Generated<string>;
  clinic_id: string;
  email: string;
  password_hash: string;
  role: "CLINIC_ADMIN" | "CLINIC_MANAGER";
  status: "ACTIVE" | "SUSPENDED";
  created_by_platform_admin: string | null;
  suspended_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ClinicSessionsTable {
  id: Generated<string>;
  clinic_account_id: string;
  refresh_token_hash: string;
  token_chain_id: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: ColumnType<Date, Date, never>;
  revoked_at: ColumnType<Date | null, Date | null, Date | null>;
  last_used_at: ColumnType<Date, Date | undefined, Date>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    clinic_accounts: ClinicAccountsTable;
    clinic_sessions: ClinicSessionsTable;
  }
}
