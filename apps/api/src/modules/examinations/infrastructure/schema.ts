// Fusão de declaração das tabelas `examinations`/`exam_results` (schema.md §3) no `Database`
// partilhado — só a infrastructure deste módulo acede a estas tabelas (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface ExaminationsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  name: string;
  exam_date: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  clinic_id: ColumnType<string | null, string | null | undefined, string | null>;
  clinic_name: ColumnType<string | null, string | null | undefined, string | null>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ExamResultsTable {
  id: Generated<string>;
  examination_id: string;
  parameter: string;
  value_numeric: ColumnType<number | string | null, number | string | null | undefined, number | string | null>;
  value_text: ColumnType<string | null, string | null | undefined, string | null>;
  unit: ColumnType<string | null, string | null | undefined, string | null>;
  reference_min: ColumnType<number | string | null, number | string | null | undefined, number | string | null>;
  reference_max: ColumnType<number | string | null, number | string | null | undefined, number | string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    examinations: ExaminationsTable;
    exam_results: ExamResultsTable;
  }
}
