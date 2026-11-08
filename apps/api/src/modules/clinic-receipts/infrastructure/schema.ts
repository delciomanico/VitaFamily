// Fusão de declaração das tabelas de recibos (schema.md §3f, `0030`) no `Database` partilhado — só a infrastructure deste
// módulo acede a elas (conventions.md §3.5). `reimbursement_claim_receipts` pertence a `insurance`.
import type { ColumnType, Generated } from "kysely";

export interface ClinicReceiptCountersTable {
  clinic_id: string;
  last_number: number;
}

export interface ClinicReceiptsTable {
  id: string;
  clinic_id: string;
  number: number;
  booking_kind: "APPOINTMENT" | "EXAM" | "VISIT";
  booking_id: string;
  status: ColumnType<"ISSUED" | "VOIDED", "ISSUED" | "VOIDED" | undefined, "ISSUED" | "VOIDED">;
  payment_method: "CASH" | "CARD" | "TRANSFER" | "INSURANCE";
  currency: string;
  /** bigint (pg devolve texto). */
  total_minor: ColumnType<string, number, never>;
  patient_name: string;
  note: string | null;
  issuer: ColumnType<{ name: string; address?: string | null; phone?: string | null; email?: string | null }, string, never>;
  issued_at: Date;
  issued_by_clinic_account_id: string | null;
  voided_at: ColumnType<Date | null, never, Date | null>;
  void_reason: ColumnType<string | null, never, string | null>;
  voided_by_clinic_account_id: ColumnType<string | null, never, string | null>;
}

export interface ClinicReceiptLinesTable {
  id: Generated<string>;
  clinic_id: string;
  receipt_id: string;
  position: number;
  description: string;
  amount_minor: ColumnType<string, number, never>;
  service_type_id: string | null;
}

export interface ClinicReceiptLinksTable {
  receipt_id: string;
  family_id: string;
  member_id: string;
  created_at: ColumnType<Date, Date, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    clinic_receipt_counters: ClinicReceiptCountersTable;
    clinic_receipts: ClinicReceiptsTable;
    clinic_receipt_lines: ClinicReceiptLinesTable;
    clinic_receipt_links: ClinicReceiptLinksTable;
  }
}
