// Fusão de declaração das tabelas `insurer_accounts`, `insurance_accounts` e `insurance_sessions`
// (schema.md §3b, ADR-021) no `Database` partilhado — só a infrastructure deste módulo as acede.
import type { ColumnType, Generated } from "kysely";

export interface InsurerAccountsTable {
  id: Generated<string>;
  name: string;
  tax_id: string;
  status: "ACTIVE" | "SUSPENDED";
  created_by: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface InsuranceAccountsTable {
  id: Generated<string>;
  insurer_id: string;
  email: string;
  password_hash: string;
  role: "INSURANCE_ADMIN" | "INSURANCE_AGENT";
  status: "ACTIVE" | "SUSPENDED";
  created_by_platform_admin: string | null;
  suspended_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface InsuranceSessionsTable {
  id: Generated<string>;
  insurance_account_id: string;
  refresh_token_hash: string;
  token_chain_id: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: ColumnType<Date, Date, never>;
  revoked_at: ColumnType<Date | null, Date | null, Date | null>;
  last_used_at: ColumnType<Date, Date | undefined, Date>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

/** `0025` (schema.md §3 `insurance_policies`). */
export interface InsurancePoliciesTable {
  id: Generated<string>;
  family_id: string;
  member_id: string;
  insurer_id: string | null;
  insurer_name: string;
  policy_number: string;
  holder_name: string;
  valid_until: ColumnType<string | null, string | null | undefined, string | null>;
  created_by: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ReimbursementClaimsTable {
  id: Generated<string>;
  policy_id: string;
  insurer_id: string;
  /** `numeric`: o driver devolve `string`; converte-se no repositório. */
  amount: ColumnType<string, number, never>;
  currency: string;
  status: ColumnType<"SUBMITTED" | "APPROVED" | "REJECTED" | "PAID", "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID" | undefined, "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID">;
  decision_note: ColumnType<string | null, string | null | undefined, string | null>;
  decided_by_insurance_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  decided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  submitted_by: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ReimbursementClaimDocumentsTable {
  claim_id: string;
  document_id: string;
}

export interface ReimbursementClaimReceiptsTable {
  claim_id: string;
  receipt_id: string;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    insurer_accounts: InsurerAccountsTable;
    insurance_accounts: InsuranceAccountsTable;
    insurance_sessions: InsuranceSessionsTable;
    insurance_policies: InsurancePoliciesTable;
    reimbursement_claims: ReimbursementClaimsTable;
    reimbursement_claim_documents: ReimbursementClaimDocumentsTable;
    reimbursement_claim_receipts: ReimbursementClaimReceiptsTable;
  }
}
