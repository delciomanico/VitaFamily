// Fusão de declaração das tabelas da migração 0045 (schema.md §13) no `Database` partilhado — só a infrastructure de `consultations`
// acede a estas tabelas (conventions.md §3.5). As colunas de `payment_proofs`/`review_reports` entram nas fatias S8..S10.
import type { ColumnType, Generated } from "kysely";

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;
type Method = "IN_PERSON" | "VIDEO" | "CHAT" | "PHONE";

export interface BookingsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  professional_id: string;
  offer_id: string;
  specialty_id: string;
  method: Method;
  duration_minutes: number;
  price_kz: number;
  starts_at: Date;
  ends_at: Date;
  slot_id: Nullable<string>;
  status: ColumnType<"REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED" | "NO_SHOW", "REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | undefined, "REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED" | "NO_SHOW">;
  payment_status: ColumnType<
    "NOT_REQUIRED" | "AWAITING_PROOF" | "PROOF_SUBMITTED" | "CONFIRMED" | "REJECTED" | "DISPUTED",
    "NOT_REQUIRED" | "AWAITING_PROOF" | "PROOF_SUBMITTED" | "CONFIRMED" | "REJECTED" | "DISPUTED",
    "NOT_REQUIRED" | "AWAITING_PROOF" | "PROOF_SUBMITTED" | "CONFIRMED" | "REJECTED" | "DISPUTED"
  >;
  participant_label: string;
  status_reason: Nullable<string>;
  cancelled_by: Nullable<"FAMILY" | "PROFESSIONAL" | "SYSTEM">;
  system_reason: Nullable<"REQUEST_EXPIRED" | "PROFESSIONAL_UNAVAILABLE">;
  confirmed_at: Nullable<Date>;
  completed_at: Nullable<Date>;
  cancelled_at: Nullable<Date>;
  meeting_info: Nullable<string>;
  process_id: Nullable<string>;
  created_by_user_id: Nullable<string>;
  client_request_id: Nullable<string>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ReviewsTable {
  id: Generated<string>;
  booking_id: Nullable<string>;
}

export interface ConsultationFileDeletionsTable {
  id: Generated<string>;
  storage_key: string;
  attempts: ColumnType<number, number | undefined, number>;
  deleted_at: Nullable<Date>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    bookings: BookingsTable;
    reviews: ReviewsTable;
    consultation_file_deletions: ConsultationFileDeletionsTable;
  }
}
