-- Módulo operacional de seguradoras, Fase A / marcos S2 (mínimo) e S3 (parcial) (ADR-025, schema.md §3c, recorte em
-- `11-implementation/insurer-phase-a.md`): lista de serviços por seguradora (BR-SEG-22), coberturas de plano (sem saldo/consumo,
-- D-A2) e ligação clínica↔seguradora (`insurer_providers`, só `clinic_id`). `insurer_plans` (com `version`) já vem da 0033.
-- Isolamento (BR-SEG-14, Q13): SEM RLS; referências entre tabelas `insurer_*` por FKs compostas `(insurer_id, x_id)`.

CREATE TYPE insurer_service_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE coverage_type AS ENUM ('INCLUDED', 'LIMITED', 'EXCLUDED');
CREATE TYPE provider_type AS ENUM ('CLINIC', 'HOSPITAL', 'LABORATORY', 'PHARMACY');
CREATE TYPE provider_status AS ENUM ('ACTIVE', 'SUSPENDED');

CREATE TABLE insurer_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  category text,
  status insurer_service_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_services_insurer_id_id_key UNIQUE (insurer_id, id),
  CONSTRAINT insurer_services_code_key UNIQUE (insurer_id, code)
);
CREATE INDEX insurer_services_list_idx ON insurer_services (insurer_id, created_at DESC, id DESC);

-- Uma só versão DRAFT por nome (UC-SEG-04: `new-version` ⇒ CONFLICT se já existe outra; a BD fecha a corrida).
CREATE UNIQUE INDEX insurer_plans_one_draft_per_name_idx ON insurer_plans (insurer_id, name) WHERE status = 'DRAFT';
CREATE INDEX insurer_plans_list_idx ON insurer_plans (insurer_id, created_at DESC, id DESC);

-- `copay_pct` = % paga pela seguradora (BR-SEG-06). `limit_per_beneficiary`/`limit_per_family` existem mas a Fase A não os expõe.
-- `type`: covered=false ⇒ EXCLUDED; covered=true com `limit_per_year` ⇒ LIMITED; sem ⇒ INCLUDED (schema.md §3c).
CREATE TABLE insurer_plan_coverages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL,
  service_id uuid NOT NULL,
  type coverage_type NOT NULL,
  copay_pct numeric(5,2) NOT NULL DEFAULT 100,
  limit_per_beneficiary numeric(14,2),
  limit_per_family numeric(14,2),
  limit_per_year numeric(14,2),
  waiting_days int NOT NULL DEFAULT 0,
  requires_authorization boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_plan_coverages_plan_service_key UNIQUE (plan_id, service_id),
  CONSTRAINT insurer_plan_coverages_plan_fk FOREIGN KEY (insurer_id, plan_id) REFERENCES insurer_plans (insurer_id, id) ON DELETE CASCADE,
  CONSTRAINT insurer_plan_coverages_service_fk FOREIGN KEY (insurer_id, service_id) REFERENCES insurer_services (insurer_id, id),
  CONSTRAINT insurer_plan_coverages_copay_range CHECK (copay_pct BETWEEN 0 AND 100),
  CONSTRAINT insurer_plan_coverages_waiting_nonneg CHECK (waiting_days >= 0),
  CONSTRAINT insurer_plan_coverages_limits_nonneg CHECK (
    (limit_per_beneficiary IS NULL OR limit_per_beneficiary >= 0)
    AND (limit_per_family IS NULL OR limit_per_family >= 0)
    AND (limit_per_year IS NULL OR limit_per_year >= 0)
  ),
  CONSTRAINT insurer_plan_coverages_type_limit CHECK ((type = 'LIMITED') = (limit_per_year IS NOT NULL) OR type = 'EXCLUDED')
);
CREATE INDEX insurer_plan_coverages_plan_idx ON insurer_plan_coverages (insurer_id, plan_id);

-- Fase A: só a ligação da clínica parceira (unidades e serviços por prestador ficam para o S3 completo). `clinic_id` SET NULL:
-- apagar a clínica nunca apaga dados da seguradora. «Clínica PARTNER e ACTIVE» é garantido no serviço (cruza módulos).
CREATE TABLE insurer_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  clinic_id uuid REFERENCES clinics (id) ON DELETE SET NULL,
  name text NOT NULL,
  tax_id text,
  type provider_type NOT NULL DEFAULT 'CLINIC',
  status provider_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_providers_insurer_id_id_key UNIQUE (insurer_id, id)
);
CREATE UNIQUE INDEX insurer_providers_clinic_key ON insurer_providers (insurer_id, clinic_id) WHERE clinic_id IS NOT NULL;
CREATE INDEX insurer_providers_list_idx ON insurer_providers (insurer_id, created_at DESC, id DESC);
-- Portal da clínica: «a que seguradoras estou ligada?» (§8.4).
CREATE INDEX insurer_providers_clinic_active_idx ON insurer_providers (clinic_id) WHERE status = 'ACTIVE';
