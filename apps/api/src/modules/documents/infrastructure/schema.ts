// Fusão de declaração das tabelas `documents`, `file_deletions` (schema.md §3/§5, db/migrations/
// 0006_documents.sql) no `Database` partilhado — só a infrastructure deste módulo acede a estas
// tabelas (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface DocumentsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  prescription_id: string | null;
  examination_id: string | null;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: ColumnType<string, number, never>;
  checksum_sha256: string;
  // DEFAULT 'PENDING' (db/migrations/0006_documents.sql) — nunca definido no insert (upload-document.ts).
  scan_status: ColumnType<"PENDING" | "CLEAN" | "INFECTED", ("PENDING" | "CLEAN" | "INFECTED") | undefined, "PENDING" | "CLEAN" | "INFECTED">;
  uploaded_by: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface FileDeletionsTable {
  id: Generated<string>;
  storage_key: string;
  attempts: ColumnType<number, number | undefined, number>;
  created_at: ColumnType<Date, Date | undefined, never>;
  deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    documents: DocumentsTable;
    file_deletions: FileDeletionsTable;
  }
}
