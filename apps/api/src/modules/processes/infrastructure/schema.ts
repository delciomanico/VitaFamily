// Fusão de declaração da tabela `processes` (schema.md §4b, `db/migrations/0036_processes.sql`) no `Database`
// partilhado — só a infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
// Não há colunas `family_status`/`next_step`: o estado deriva em leitura (BR-PRC-02).
import type { ColumnType } from "kysely";

export interface ProcessesTable {
  id: string;
  family_id: string;
  member_id: string;
  kind: "ROUTINE";
  origin_type: "APPOINTMENT" | "EXAMINATION";
  origin_id: string;
  clinic_id: ColumnType<string | null, string | null | undefined, string | null>;
  opened_at: Date;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    processes: ProcessesTable;
  }
}
