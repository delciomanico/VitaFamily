// Fusão de declaração da tabela `recommendations` (schema.md §3, `db/migrations/0023_recommendations.sql`)
// no `Database` partilhado — só a infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface RecommendationsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  clinic_id: ColumnType<string | null, string | null | undefined, string | null>;
  clinic_name: string;
  clinic_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  appointment_id: ColumnType<string | null, string | null | undefined, never>;
  examination_id: ColumnType<string | null, string | null | undefined, never>;
  text: string;
  created_at: ColumnType<Date, Date | undefined, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    recommendations: RecommendationsTable;
  }
}
