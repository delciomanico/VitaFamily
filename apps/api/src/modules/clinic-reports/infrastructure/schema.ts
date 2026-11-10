// Fusão de declaração das tabelas do relatório da consulta (schema.md §3g/§3h, `0031`/`0032`) no `Database` partilhado — só a
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

export interface ClinicExamOrdersTable {
  id: Generated<string>;
  clinic_id: string;
  booking_kind: "APPOINTMENT" | "VISIT";
  booking_id: string;
  clinic_patient_id: string | null;
  name: string;
  service_type_id: string | null;
  note: string | null;
  urgent: ColumnType<boolean, boolean | undefined, boolean>;
  status: ColumnType<"ORDERED" | "SCHEDULED" | "FULFILLED" | "CANCELLED", "ORDERED" | "SCHEDULED" | "FULFILLED" | "CANCELLED" | undefined, "ORDERED" | "SCHEDULED" | "FULFILLED" | "CANCELLED">;
  booked_here: ColumnType<boolean, boolean | undefined, boolean>;
  patient_name: string;
  patient_birth_date: ColumnType<string | null, string | null | undefined, never>;
  consultation_at: Date;
  author_name: string;
  author_account_id: string | null;
  cancelled_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  cancelled_by_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ClinicExamOrderLinksTable {
  order_id: string;
  family_id: string;
  member_id: string;
  appointment_id: string;
  examination_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    clinic_exam_orders: ClinicExamOrdersTable;
    clinic_exam_order_links: ClinicExamOrderLinksTable;
    clinic_consultation_reports: ClinicConsultationReportsTable;
    clinic_consultation_report_addenda: ClinicConsultationReportAddendaTable;
  }
}
