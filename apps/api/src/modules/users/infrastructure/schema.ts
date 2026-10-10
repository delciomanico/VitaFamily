// Fusão de declaração da tabela `users` (schema.md §1) no `Database` partilhado — só a
// infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
//
// NOTA (M8, change control): esta migração (`0002_identity.sql`) criou também
// `notification_preferences` em antecipação ao módulo `notifications` (M8), e este ficheiro
// chegou a declarar `NotificationPreferencesTable`/a escrever uma linha por omissão em
// `insert()` (ver `infrastructure/repo.ts`). `modules.md` §2 atribui a posse de
// "preferências" a `notifications`, e `conventions.md` §3.5 proíbe dois módulos de acederem à
// mesma tabela pelos seus próprios repositórios — por isso essa declaração/escrita foi removida
// daqui quando `notifications` (M8) passou a existir; `notifications/infrastructure/repo.ts`
// (`findByUserId`/`upsert`) é agora o único acesso a esta tabela, com `defaultPreference()`
// (R9, todos os valores a `true`) como fallback em memória para um User sem linha própria —
// equivalente ao que esta inserção por omissão fazia.
import type { ColumnType, Generated } from "kysely";

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  name: string;
  birth_date: ColumnType<string, string, string>;
  timezone: string;
  status: Generated<"PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED">;
  platform_role: Generated<"NONE" | "PLATFORM_ADMIN">;
  email_verified_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  terms_accepted_version: string;
  terms_accepted_at: ColumnType<Date, Date, Date>;
  suspended_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  suspension_reason: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    users: UsersTable;
  }
}
