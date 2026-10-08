// Fusão de declaração das tabelas `auth_tokens` e `sessions` (schema.md §1) no `Database`
// partilhado — só a infrastructure deste módulo acede a estas tabelas.
import type { ColumnType, Generated } from "kysely";

export interface AuthTokensTable {
  id: Generated<string>;
  user_id: string;
  type: "EMAIL_VERIFICATION" | "PASSWORD_RESET";
  token_hash: string;
  expires_at: ColumnType<Date, Date, never>;
  used_at: ColumnType<Date | null, Date | null, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
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
    auth_tokens: AuthTokensTable;
    sessions: SessionsTable;
  }
}
