// Fusão de declaração da tabela da migração 0047 (schema.md §15) no `Database` partilhado — só a infrastructure de `ai-assistant` acede a `ai_consents`
// (conventions.md §3.5). Nunca se guardam chaves, tokens, sintomas, contexto nem respostas.
import type { ColumnType, Generated } from "kysely";

export interface AiConsentsTable {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  member_id: string;
  provider: "GEMINI" | "CLAUDE" | "OPENAI";
  consent_version: string;
  granted_at: Date;
  revoked_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    ai_consents: AiConsentsTable;
  }
}
