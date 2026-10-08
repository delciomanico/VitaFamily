// Fusão de declaração da tabela `audit_logs` no `Database` partilhado (platform/db) — só a
// infrastructure deste módulo conhece o esquema físico (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface AuditLogsTable {
  id: Generated<string>;
  occurred_at: ColumnType<Date, Date | string, never>;
  actor_type: "USER" | "SYSTEM" | "PLATFORM_ADMIN";
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  family_id: string | null;
  subject_member_id: string | null;
  result: "SUCCESS" | "DENIED" | "FAILURE";
  ip: string | null;
  user_agent: string | null;
  request_id: string;
  metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    audit_logs: AuditLogsTable;
  }
}
