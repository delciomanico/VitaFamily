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
  /** Fatia 2 (`0037`): nulo = por classificar. */
  service_kind_id: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface GuideTypesTable {
  code: string;
  sort_order: number;
  active: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface ExpenseTypesTable {
  code: string;
  legacy_code: string;
  default_guide_type: string;
  default_name: string;
  sort_order: number;
  active: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface PolicySettingDefinitionsTable {
  key: string;
  unit: "HOURS" | "DAYS";
  min_value: number;
  max_value: number;
  default_value: number;
  allows_service_scope: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface InsurerServiceKindsTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  code: string;
  name: ColumnType<string, string, string>;
  guide_type: ColumnType<string, string, string>;
  expense_type: ColumnType<string, string, string>;
  status: ColumnType<"ACTIVE" | "INACTIVE", "ACTIVE" | "INACTIVE" | undefined, "ACTIVE" | "INACTIVE">;
}

export interface InsurerPolicySettingsTable extends Timestamps {
  id: Generated<string>;
  insurer_id: string;
  setting_key: string;
  service_id: string | null;
  value: ColumnType<number, number, number>;
  updated_by_insurance_account_id: ColumnType<string | null, string | null | undefined, string | null>;
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

type NullableTime = ColumnType<Date | null, Date | null | undefined, Date | null>;
type Money = ColumnType<string, number | string, number | string>;
type AuthorizationStatusDb = "SUBMITTED" | "IN_REVIEW" | "INFO_REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED";

/** Fatia 3 (`0039`, schema.md §3c): nenhuma coluna clínica (C2, TC-AUT-17). `created_at`/`updated_at` definidos pela aplicação. */
export interface InsurerAuthorizationsTable {
  id: string;
  insurer_id: string;
  beneficiary_id: string;
  provider_id: string;
  service_id: string;
  guide_type: string;
  process_id: ColumnType<string | null, string | null | undefined, string | null>;
  parent_request_id: ColumnType<string | null, string | null | undefined, string | null>;
  status: ColumnType<AuthorizationStatusDb, AuthorizationStatusDb | undefined, AuthorizationStatusDb>;
  closed_reason: ColumnType<"INFO_TIMEOUT" | "CLINIC_CANCELLED" | null, "INFO_TIMEOUT" | "CLINIC_CANCELLED" | null | undefined, "INFO_TIMEOUT" | "CLINIC_CANCELLED" | null>;
  justification: string;
  requested_amount: Money;
  authorized_amount: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  expected_on: ColumnType<string, string, string>;
  code: ColumnType<string | null, string | null | undefined, string | null>;
  valid_until: NullableTime;
  decision_note: ColumnType<string | null, string | null | undefined, string | null>;
  decided_by_insurance_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  decided_at: NullableTime;
  decision_due_at: ColumnType<Date, Date, Date>;
  info_expires_at: NullableTime;
  submitted_by_clinic_account_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date, never>;
  updated_at: ColumnType<Date, Date, Date>;
}

export interface InsurerAuthorizationEventsTable {
  id: Generated<string>;
  insurer_id: string;
  authorization_id: string;
  from_status: AuthorizationStatusDb | null;
  to_status: AuthorizationStatusDb;
  actor_type: "CLINIC_ACCOUNT" | "INSURANCE_ACCOUNT" | "SYSTEM";
  actor_account_id: string | null;
  channel: "PORTAL" | "PHONE" | "WHATSAPP" | "PHOTO" | "API";
  note: string | null;
  occurred_at: Date;
}

export interface InsurerAttachmentsTable {
  id: string;
  insurer_id: string;
  authorization_id: string;
  kind: "QUOTE" | "INSURER_FORM" | "ID_COPY" | "OTHER_ADMIN";
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: ColumnType<string, number, never>;
  checksum_sha256: string;
  uploaded_by_clinic_account_id: string | null;
  created_at: ColumnType<Date, Date, never>;
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
    guide_types: GuideTypesTable;
    expense_types: ExpenseTypesTable;
    policy_setting_definitions: PolicySettingDefinitionsTable;
    insurer_service_kinds: InsurerServiceKindsTable;
    insurer_policy_settings: InsurerPolicySettingsTable;
    insurer_plan_coverages: InsurerPlanCoveragesTable;
    insurer_providers: InsurerProvidersTable;
    insurer_authorizations: InsurerAuthorizationsTable;
    insurer_authorization_events: InsurerAuthorizationEventsTable;
    insurer_attachments: InsurerAttachmentsTable;
  }
}
