-- Módulo operacional de seguradoras, Fase A / marco S1 (ADR-025, schema.md §3c, recorte em
-- `11-implementation/insurer-phase-a.md`): moeda e flag do módulo em `insurer_accounts`, papéis alargados,
-- empresas, beneficiários, pedidos de ligação, apólices, importações e `insurer_plans` (alvo de `insurer_policies.plan_id`).
-- `insurer_services`/`insurer_plan_coverages`/`insurer_providers` + enums respetivos ficam para S2/S3 (migração seguinte).
-- Isolamento (BR-SEG-14, Q13): SEM RLS; todas as referências entre tabelas `insurer_*` são FKs compostas
-- `(insurer_id, x_id) -> t(insurer_id, id)`, para a BD rejeitar referências entre seguradoras.
-- `ADD VALUE` numa transação (PostgreSQL >= 12) é permitido desde que o valor novo não seja usado na mesma transação
-- (nenhum CHECK/índice desta migração usa os literais; mesmo padrão de 0029–0032).

ALTER TYPE insurance_account_role ADD VALUE 'BENEFICIARY_MANAGER';
ALTER TYPE insurance_account_role ADD VALUE 'AUTHORIZATION_ANALYST';
ALTER TYPE insurance_account_role ADD VALUE 'CLAIMS_MANAGER';
ALTER TYPE insurance_account_role ADD VALUE 'FINANCE_MANAGER';

ALTER TABLE insurer_accounts
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'AOA',
  ADD COLUMN operational_module_enabled boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT insurer_accounts_currency_format CHECK (currency ~ '^[A-Z]{3}$');

-- BR-SEG-19 / schema.md §3c (ratificado 2026-11-11): as linhas existentes mantêm o valor; as novas copiam a moeda
-- da seguradora no serviço (um INSERT sem moeda falha).
ALTER TABLE reimbursement_claims ALTER COLUMN currency DROP DEFAULT;

CREATE TYPE insurer_company_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE beneficiary_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE beneficiary_relationship AS ENUM ('HOLDER', 'SPOUSE', 'CHILD', 'OTHER');
CREATE TYPE link_request_status AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'REVOKED');
CREATE TYPE plan_status_ins AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE insurer_policy_status AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED');
CREATE TYPE import_format AS ENUM ('CSV', 'XLSX');
CREATE TYPE import_status AS ENUM ('PREVIEW', 'COMMITTED', 'FAILED', 'CANCELLED');

CREATE TABLE insurer_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  name text NOT NULL,
  tax_id text NOT NULL,
  status insurer_company_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_companies_insurer_id_id_key UNIQUE (insurer_id, id),
  CONSTRAINT insurer_companies_tax_id_key UNIQUE (insurer_id, tax_id)
);

CREATE TABLE insurer_beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  company_id uuid,
  holder_id uuid,
  name text NOT NULL,
  id_document_type text NOT NULL,
  id_document_number text NOT NULL,
  birth_date date NOT NULL,
  relationship beneficiary_relationship NOT NULL DEFAULT 'HOLDER',
  card_number text NOT NULL,
  card_version int NOT NULL DEFAULT 1,
  status beneficiary_status NOT NULL DEFAULT 'PENDING',
  -- BR-SEG-24: nota obrigatória da última passagem a SUSPENDED/CANCELLED (texto livre; fora de auditoria e logs).
  status_note text,
  -- Ligação consentida (BR-SEG-20): única fronteira entre dados da seguradora e dados de saúde (SET NULL: nunca apaga o beneficiário).
  family_id uuid,
  family_member_id uuid,
  -- BR-SEG-20: só o HMAC do código emitido pela seguradora; nulos = sem código ativo (emitir novo substitui).
  claim_code_hash text,
  claim_code_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_beneficiaries_insurer_id_id_key UNIQUE (insurer_id, id),
  CONSTRAINT insurer_beneficiaries_document_key UNIQUE (insurer_id, id_document_type, id_document_number),
  CONSTRAINT insurer_beneficiaries_card_number_key UNIQUE (insurer_id, card_number),
  CONSTRAINT insurer_beneficiaries_company_fk FOREIGN KEY (insurer_id, company_id) REFERENCES insurer_companies (insurer_id, id),
  CONSTRAINT insurer_beneficiaries_holder_fk FOREIGN KEY (insurer_id, holder_id) REFERENCES insurer_beneficiaries (insurer_id, id),
  CONSTRAINT insurer_beneficiaries_member_fk FOREIGN KEY (family_id, family_member_id) REFERENCES family_members (family_id, id) ON DELETE SET NULL,
  CONSTRAINT insurer_beneficiaries_holder_rel CHECK ((relationship = 'HOLDER') = (holder_id IS NULL)),
  CONSTRAINT insurer_beneficiaries_link_pair CHECK ((family_id IS NULL) = (family_member_id IS NULL)),
  CONSTRAINT insurer_beneficiaries_claim_code_pair CHECK ((claim_code_hash IS NULL) = (claim_code_expires_at IS NULL)),
  CONSTRAINT insurer_beneficiaries_card_version_positive CHECK (card_version >= 1)
);
CREATE UNIQUE INDEX insurer_beneficiaries_member_unique_idx ON insurer_beneficiaries (insurer_id, family_member_id) WHERE family_member_id IS NOT NULL;
CREATE INDEX insurer_beneficiaries_list_idx ON insurer_beneficiaries (insurer_id, created_at DESC, id DESC);
CREATE INDEX insurer_beneficiaries_holder_idx ON insurer_beneficiaries (insurer_id, holder_id) WHERE holder_id IS NOT NULL;
CREATE INDEX insurer_beneficiaries_company_idx ON insurer_beneficiaries (insurer_id, company_id) WHERE company_id IS NOT NULL;

-- A linha só nasce quando o paciente apresenta um código válido (código inválido/expirado não cria linha).
CREATE TABLE insurer_beneficiary_link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  beneficiary_id uuid NOT NULL,
  requested_by uuid REFERENCES users (id) ON DELETE SET NULL,
  family_id uuid NOT NULL,
  family_member_id uuid NOT NULL,
  status link_request_status NOT NULL DEFAULT 'PENDING',
  decided_by_insurance_account_id uuid REFERENCES insurance_accounts (id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_link_requests_insurer_id_id_key UNIQUE (insurer_id, id),
  CONSTRAINT insurer_link_requests_beneficiary_fk FOREIGN KEY (insurer_id, beneficiary_id) REFERENCES insurer_beneficiaries (insurer_id, id),
  CONSTRAINT insurer_link_requests_member_fk FOREIGN KEY (family_id, family_member_id) REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  CONSTRAINT insurer_link_requests_rejected_needs_note CHECK (status <> 'REJECTED' OR decision_note IS NOT NULL)
);
CREATE UNIQUE INDEX insurer_link_requests_pending_idx ON insurer_beneficiary_link_requests (beneficiary_id) WHERE status = 'PENDING';
CREATE INDEX insurer_link_requests_list_idx ON insurer_beneficiary_link_requests (insurer_id, status, created_at DESC, id DESC);

-- Só o alvo da FK composta das apólices; coberturas/serviços/API de planos chegam em S2.
CREATE TABLE insurer_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  status plan_status_ins NOT NULL DEFAULT 'DRAFT',
  auto_approval_ceiling numeric(14,2),
  amount_tolerance_pct numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_plans_insurer_id_id_key UNIQUE (insurer_id, id),
  CONSTRAINT insurer_plans_name_version_key UNIQUE (insurer_id, name, version),
  CONSTRAINT insurer_plans_ceiling_nonneg CHECK (auto_approval_ceiling IS NULL OR auto_approval_ceiling >= 0),
  CONSTRAINT insurer_plans_tolerance_range CHECK (amount_tolerance_pct BETWEEN 0 AND 100)
);

CREATE TABLE insurer_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL,
  company_id uuid,
  holder_id uuid NOT NULL,
  number text NOT NULL,
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  status insurer_policy_status NOT NULL DEFAULT 'DRAFT',
  -- BR-SEG-24: nota obrigatória da última passagem a SUSPENDED/CANCELLED (fora de auditoria e logs).
  status_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_policies_insurer_id_id_key UNIQUE (insurer_id, id),
  CONSTRAINT insurer_policies_number_key UNIQUE (insurer_id, number),
  CONSTRAINT insurer_policies_plan_fk FOREIGN KEY (insurer_id, plan_id) REFERENCES insurer_plans (insurer_id, id),
  CONSTRAINT insurer_policies_company_fk FOREIGN KEY (insurer_id, company_id) REFERENCES insurer_companies (insurer_id, id),
  CONSTRAINT insurer_policies_holder_fk FOREIGN KEY (insurer_id, holder_id) REFERENCES insurer_beneficiaries (insurer_id, id),
  CONSTRAINT insurer_policies_valid_range CHECK (valid_to >= valid_from)
);
CREATE INDEX insurer_policies_list_idx ON insurer_policies (insurer_id, created_at DESC, id DESC);
CREATE INDEX insurer_policies_holder_idx ON insurer_policies (insurer_id, holder_id);
CREATE INDEX insurer_policies_expire_idx ON insurer_policies (valid_to) WHERE status = 'ACTIVE';

CREATE TABLE insurer_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  format import_format NOT NULL,
  row_count int NOT NULL,
  status import_status NOT NULL DEFAULT 'PREVIEW',
  -- Resumo e erros por linha (sem dados pessoais: só nº de linha, campo e código); contagens do lote.
  error_report jsonb,
  -- Linhas válidas à espera do `commit` (EXTENSÃO a schema.md §3c: o contrato não tem corpo no commit). Dados pessoais de
  -- terceiros: limpa-se (NULL) ao confirmar ou cancelar o lote.
  rows jsonb,
  created_by_insurance_account_id uuid REFERENCES insurance_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_import_batches_insurer_id_id_key UNIQUE (insurer_id, id),
  CONSTRAINT insurer_import_batches_row_count_range CHECK (row_count BETWEEN 1 AND 5000)
);
CREATE INDEX insurer_import_batches_list_idx ON insurer_import_batches (insurer_id, created_at DESC);
