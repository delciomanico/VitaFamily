// Fusão de declaração das tabelas do relatório da consulta (schema.md §3g, `0031`) no `Database` partilhado — só a
// infrastructure deste módulo acede a elas (conventions.md §3.5). `clinic_exam_result_drafts` pertence a `examinations`.
import type { ColumnType, Generated } from "kysely";

export interface ClinicConsultationReportsTable {
  id: Generated<string>;
  clinic_id: string;
  booking_kind: "APPOINTMENT" | "VISIT";
  booking_id: string;
  clinic_patient_id: string | null;
  status: ColumnType<"DRAFT" | "FINAL", "DRAFT" | "FINAL" | undefined, "DRAFT" | "FINAL">;
  reason: string | null;
  findings: string | null;
  impression: string | null;
  plan: string | null;
  shared_with_patient: boolean;
  patient_name: string;
  patient_birth_date: ColumnType<string | null, string | null | undefined, string | null>;
  consultation_at: Date;
  specialty: string | null;
  author_name: string;
  issuer: ColumnType<{ name: string; address?: string | null; phone?: string | null; email?: string | null } | null, string | null, string | null>;
  author_account_id: string | null;
  finalized_at: Date | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ClinicConsultationReportAddendaTable {
  id: Generated<string>;
  clinic_id: string;
  report_id: string;
  text: string;
  author_name: string;
  author_account_id: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    clinic_consultation_reports: ClinicConsultationReportsTable;
    clinic_consultation_report_addenda: ClinicConsultationReportAddendaTable;
  }
}
