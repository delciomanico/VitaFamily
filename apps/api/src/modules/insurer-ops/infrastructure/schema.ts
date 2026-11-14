// Fusão de declaração das tabelas `insurer_*` da Fase A/S1 (schema.md §3c, migração 0033) no `Database` partilhado — só a
// infrastructure deste módulo as acede. As colunas `date` chegam como `string` (platform/db).
import type { ColumnType, Generated } from "kysely";

interface Timestamps {
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface InsurerCompaniesTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  name: string;
  tax_id: string;
  status: ColumnType<"ACTIVE" | "INACTIVE", "ACTIVE" | "INACTIVE" | undefined, "ACTIVE" | "INACTIVE">;
}

export type BeneficiaryStatusDb = "PENDING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type RelationshipDb = "HOLDER" | "SPOUSE" | "CHILD" | "OTHER";

export interface InsurerBeneficiariesTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  company_id: ColumnType<string | null, string | null | undefined, string | null>;
  holder_id: string | null;
  name: ColumnType<string, string, string>;
  id_document_type: string;
  id_document_number: string;
  birth_date: ColumnType<string, string, string>;
  relationship: RelationshipDb;
  card_number: string;
  card_version: ColumnType<number, number | undefined, number>;
  status: ColumnType<BeneficiaryStatusDb, BeneficiaryStatusDb | undefined, BeneficiaryStatusDb>;
  status_note: ColumnType<string | null, string | null | undefined, string | null>;
  family_id: ColumnType<string | null, string | null | undefined, string | null>;
  family_member_id: ColumnType<string | null, string | null | undefined, string | null>;
  claim_code_hash: ColumnType<string | null, string | null | undefined, string | null>;
  claim_code_expires_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export interface InsurerBeneficiaryLinkRequestsTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  beneficiary_id: string;
  requested_by: string | null;
  family_id: string;
  family_member_id: string;
  status: ColumnType<"PENDING" | "CONFIRMED" | "REJECTED" | "REVOKED", "PENDING" | "CONFIRMED" | "REJECTED" | "REVOKED" | undefined, "PENDING" | "CONFIRMED" | "REJECTED" | "REVOKED">;
  decided_by_insurance_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  decided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  decision_note: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface InsurerPlansTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  name: string;
  version: ColumnType<number, number | undefined, number>;
  status: ColumnType<"DRAFT" | "ACTIVE" | "ARCHIVED", "DRAFT" | "ACTIVE" | "ARCHIVED" | undefined, "DRAFT" | "ACTIVE" | "ARCHIVED">;
}

export type PolicyStatusDb = "DRAFT" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CANCELLED";

export interface InsurerPoliciesTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  plan_id: ColumnType<string, string, string>;
  company_id: ColumnType<string | null, string | null | undefined, string | null>;
  holder_id: string;
  number: string;
  valid_from: ColumnType<string, string, string>;
  valid_to: ColumnType<string, string, string>;
  status: ColumnType<PolicyStatusDb, PolicyStatusDb | undefined, PolicyStatusDb>;
  status_note: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface InsurerImportBatchesTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  format: "CSV" | "XLSX";
  row_count: number;
  status: ColumnType<"PREVIEW" | "COMMITTED" | "FAILED" | "CANCELLED", "PREVIEW" | "COMMITTED" | "FAILED" | "CANCELLED" | undefined, "PREVIEW" | "COMMITTED" | "FAILED" | "CANCELLED">;
  /** jsonb: escreve-se `JSON.stringify(...)`; o driver devolve o objeto já analisado. */
  error_report: ColumnType<unknown, string | null, string | null>;
  rows: ColumnType<unknown, string | null, string | null>;
  created_by_insurance_account_id: string | null;
}

export interface InsurerServicesTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  code: string;
  name: string;
  category: ColumnType<string | null, string | null | undefined, string | null>;
  status: ColumnType<"ACTIVE" | "INACTIVE", "ACTIVE" | "INACTIVE" | undefined, "ACTIVE" | "INACTIVE">;
}

type NullableMoney = ColumnType<string | null, number | string | null | undefined, number | string | null>;

export interface InsurerPlanCoveragesTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  plan_id: string;
  service_id: string;
  type: "INCLUDED" | "LIMITED" | "EXCLUDED";
  copay_pct: ColumnType<string, number | string | undefined, number | string>;
  limit_per_beneficiary: NullableMoney;
  limit_per_family: NullableMoney;
  limit_per_year: NullableMoney;
  waiting_days: ColumnType<number, number | undefined, number>;
  requires_authorization: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface InsurerProvidersTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  clinic_id: ColumnType<string | null, string | null | undefined, string | null>;
  name: string;
  tax_id: ColumnType<string | null, string | null | undefined, string | null>;
  type: ColumnType<"CLINIC" | "HOSPITAL" | "LABORATORY" | "PHARMACY", "CLINIC" | "HOSPITAL" | "LABORATORY" | "PHARMACY" | undefined, never>;
  status: ColumnType<"ACTIVE" | "SUSPENDED", "ACTIVE" | "SUSPENDED" | undefined, "ACTIVE" | "SUSPENDED">;
}

declare module "../../../platform/db/index.js" {
  interface Database {
    insurer_companies: InsurerCompaniesTable;
    insurer_beneficiaries: InsurerBeneficiariesTable;
    insurer_beneficiary_link_requests: InsurerBeneficiaryLinkRequestsTable;
    insurer_plans: InsurerPlansTable;
    insurer_policies: InsurerPoliciesTable;
    insurer_import_batches: InsurerImportBatchesTable;
    insurer_services: InsurerServicesTable;
    insurer_plan_coverages: InsurerPlanCoveragesTable;
    insurer_providers: InsurerProvidersTable;
  }
}
