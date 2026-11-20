// Fusão de declaração da tabela `prescriptions` (schema.md §3) no `Database` partilhado — só a
// infrastructure deste módulo acede a esta tabela (conventions.md §3.5).
import type { ColumnType, Generated } from "kysely";

export interface PrescriptionsTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  issued_on: string;
  doctor_name: ColumnType<string | null, string | null | undefined, string | null>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  /** BR-RX-07/D18: default 'FAMILY' na BD (migração 0017). */
  issued_by: Generated<"FAMILY" | "CLINIC" | "PROFESSIONAL">;
  issued_by_clinic_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  appointment_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** MK4 (migração 0046): autor e marcação da receita digital (`SET NULL` se desaparecerem; `issued_by` mantém-se). */
  issued_by_professional_id: ColumnType<string | null, string | null | undefined, string | null>;
  booking_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    prescriptions: PrescriptionsTable;
  }
}
