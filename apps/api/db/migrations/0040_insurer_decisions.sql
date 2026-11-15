-- Decisão pela seguradora, auto-aprovação, SLA e papel SUPERVISOR (marco B fatia 4, ADR-035; schema.md §3c, migrations.md "0040",
-- BR-AUT-03/17..23). Só aditiva: não apaga nem reescreve dados; o único preenchimento é `decided_by_kind` (pedidos já decididos pela
-- fatia 3, única forma de decisão que então existia). SQL simples, sem triggers nem lógica em defaults.
-- `ADD VALUE` numa transação (PostgreSQL >= 12) é permitido desde que o valor novo não seja usado nesta migração (como 0033/0039).
ALTER TYPE authorization_closed_reason ADD VALUE 'ANALYST_CANCELLED';
ALTER TYPE insurance_account_role ADD VALUE 'SUPERVISOR';

CREATE TYPE authorization_decider AS ENUM ('ANALYST', 'SUPERVISOR', 'SYSTEM');

-- Quem tomou a decisão ATUAL; marca de atribuição; marca de SLA; rasto da auto-aprovação (só códigos, ids e nome da regra: C2).
ALTER TABLE insurer_authorizations
  ADD COLUMN decided_by_kind authorization_decider,
  ADD COLUMN assigned_to_insurance_account_id uuid REFERENCES insurance_accounts (id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN escalated_at timestamptz,
  ADD COLUMN auto_approval_trace jsonb;

UPDATE insurer_authorizations SET decided_by_kind = 'ANALYST' WHERE status IN ('APPROVED', 'REJECTED') AND decided_by_kind IS NULL;
ALTER TABLE insurer_authorizations
  ADD CONSTRAINT insurer_authorizations_decided_by_check CHECK (status NOT IN ('APPROVED', 'REJECTED') OR decided_by_kind IS NOT NULL);

-- Eventos: decisor (sem depender da conta, que pode ser removida) e nota INTERNA (só seguradora).
ALTER TABLE insurer_authorization_events
  ADD COLUMN actor_role text CHECK (actor_role IN ('ANALYST', 'SUPERVISOR')),
  ADD COLUMN internal_note text;

-- AutoApprovalRule (BR-AUT-23): um alvo (tipo de serviço OU serviço) e um valor máximo; uma regra ATIVA por alvo; sem campo de ordem.
CREATE TABLE insurer_auto_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE CASCADE,
  name text NOT NULL,
  service_kind_id uuid,
  service_id uuid,
  max_amount numeric(14, 2) NOT NULL,
  active boolean NOT NULL,
  created_by_insurance_account_id uuid REFERENCES insurance_accounts (id) ON DELETE SET NULL,
  updated_by_insurance_account_id uuid REFERENCES insurance_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT insurer_auto_approval_rules_insurer_id_id_key UNIQUE (insurer_id, id),
  CONSTRAINT insurer_auto_approval_rules_kind_fk FOREIGN KEY (insurer_id, service_kind_id) REFERENCES insurer_service_kinds (insurer_id, id) ON DELETE RESTRICT,
  CONSTRAINT insurer_auto_approval_rules_service_fk FOREIGN KEY (insurer_id, service_id) REFERENCES insurer_services (insurer_id, id) ON DELETE RESTRICT,
  CONSTRAINT insurer_auto_approval_rules_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT insurer_auto_approval_rules_max_amount_check CHECK (max_amount > 0),
  CONSTRAINT insurer_auto_approval_rules_target_check CHECK (num_nonnulls(service_kind_id, service_id) = 1)
);
CREATE UNIQUE INDEX insurer_auto_approval_rules_kind_active_idx ON insurer_auto_approval_rules (insurer_id, service_kind_id) WHERE active AND service_kind_id IS NOT NULL;
CREATE UNIQUE INDEX insurer_auto_approval_rules_service_active_idx ON insurer_auto_approval_rules (insurer_id, service_id) WHERE active AND service_id IS NOT NULL;
CREATE INDEX insurer_auto_approval_rules_insurer_active_idx ON insurer_auto_approval_rules (insurer_id, active);

-- Validade da aprovação (BR-AUT-07): chave de política em dados (limites propostos, ADR-035 §6).
INSERT INTO policy_setting_definitions (key, unit, min_value, max_value, default_value, allows_service_scope)
VALUES ('AUTHORIZATION_VALIDITY_DAYS', 'DAYS', 1, 365, 30, false)
ON CONFLICT DO NOTHING;

-- BR-AUT-09 emendado: uma aprovação válida para a mesma data também bloqueia o duplicado (reverter ou recusar liberta a chave).
DROP INDEX insurer_authorizations_open_duplicate_idx;
CREATE UNIQUE INDEX insurer_authorizations_open_duplicate_idx ON insurer_authorizations (insurer_id, beneficiary_id, provider_id, service_id, expected_on)
  WHERE status IN ('SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED', 'APPROVED');

-- Índices da fila, do histórico, do filtro «meus» e do job de SLA (indexes.md).
CREATE INDEX insurer_authorizations_queue_idx ON insurer_authorizations (insurer_id, status, decision_due_at, id);
CREATE INDEX insurer_authorizations_history_idx ON insurer_authorizations (insurer_id, updated_at DESC, id DESC);
CREATE INDEX insurer_authorizations_assigned_idx ON insurer_authorizations (assigned_to_insurance_account_id) WHERE assigned_to_insurance_account_id IS NOT NULL;
CREATE INDEX insurer_authorizations_sla_idx ON insurer_authorizations (decision_due_at) WHERE status = 'IN_REVIEW' AND escalated_at IS NULL;
