// Fusão de declaração das tabelas `families`, `family_members`, `guardianships`, `invitations`
// (schema.md §2) no `Database` partilhado — só a infrastructure deste módulo acede a estas tabelas
// (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface FamiliesTable {
  id: Generated<string>;
  name: string;
  created_by: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface FamilyMembersTable {
  id: Generated<string>;
  family_id: string;
  user_id: ColumnType<string | null, string | null | undefined, string | null>;
  name: string;
  birth_date: ColumnType<string, string, string>;
  role: ColumnType<"FAMILY_ADMIN" | "FAMILY_MEMBER" | null, "FAMILY_ADMIN" | "FAMILY_MEMBER" | null | undefined, "FAMILY_ADMIN" | "FAMILY_MEMBER" | null>;
  is_dependent: Generated<boolean>;
  blood_type: ColumnType<string | null, string | null | undefined, string | null>;
  status: Generated<"ACTIVE" | "BLOCKED">;
  blocked_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  scheduled_deletion_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface GuardianshipsTable {
  id: Generated<string>;
  family_id: string;
  dependent_id: string;
  guardian_id: string;
  is_primary: Generated<boolean>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface InvitationsTable {
  id: Generated<string>;
  family_id: string;
  email: string;
  type: "MEMBER" | "DEPENDENT_ACCOUNT";
  member_id: ColumnType<string | null, string | null | undefined, string | null>;
  token_hash: string;
  status: Generated<"PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED">;
  expires_at: ColumnType<Date, Date, Date>;
  invited_by: ColumnType<string | null, string | null | undefined, string | null>;
  accepted_by: ColumnType<string | null, string | null | undefined, string | null>;
  accepted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    families: FamiliesTable;
    family_members: FamilyMembersTable;
    guardianships: GuardianshipsTable;
    invitations: InvitationsTable;
  }
}
