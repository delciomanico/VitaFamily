// Fusão de declaração das tabelas `examinations`/`exam_results` (schema.md §3) no `Database`
// partilhado — só a infrastructure deste módulo acede a estas tabelas (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface ExaminationsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  name: string;
  exam_date: string;
  /** `REQUESTED`/`REJECTED` ficam no enum de BD mas a CHECK `examinations_no_request_flow_check` (0022) proíbe-os. */
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  clinic_id: ColumnType<string | null, string | null | undefined, string | null>;
  clinic_name: ColumnType<string | null, string | null | undefined, string | null>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  /** D19 — `db/migrations/0021_clinic_exams.sql`. */
  scheduled_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  slot_id: ColumnType<string | null, string | null | undefined, string | null>;
  response_note: ColumnType<string | null, string | null | undefined, string | null>;
  issued_by: ColumnType<"FAMILY" | "CLINIC", "FAMILY" | "CLINIC" | undefined, "FAMILY" | "CLINIC">;
  issued_by_clinic_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  results_issued_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  clinic_result_note: ColumnType<string | null, string | null | undefined, string | null>;
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

/** M15 T (`0031`, schema.md §3g): rascunho de resultados — dado de saúde, nunca em logs/auditoria. */
export interface ClinicExamResultDraftsTable {
  examination_id: string;
  results: ColumnType<unknown[], string, string>;
  result_note: string | null;
  updated_by_clinic_account_id: string | null;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    examinations: ExaminationsTable;
    exam_results: ExamResultsTable;
    clinic_exam_result_drafts: ClinicExamResultDraftsTable;
  }
}
