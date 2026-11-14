-- Pedido de autorização pelo prestador (marco B fatia 3, ADR-034; schema.md §3c, migrations.md "0039", BR-AUT-01..16).
-- Só aditiva: as tabelas de S4 nunca foram criadas (nada a migrar). SQL simples, sem triggers nem lógica em defaults:
-- `decision_due_at` e `channel` são definidos pela aplicação; a máquina de estados vive em `insurer-ops/domain`.
-- `0038` fica reservada (moeda, condicional); o runner aceita lacunas.
-- `ADD VALUE` numa transação (PostgreSQL >= 12) é permitido desde que o valor novo não seja usado nesta migração (como 0029–0032).
ALTER TYPE process_kind ADD VALUE 'AUTHORIZED';
ALTER TYPE process_origin_type ADD VALUE 'AUTHORIZATION';

CREATE TYPE authorization_status AS ENUM ('SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE authorization_closed_reason AS ENUM ('INFO_TIMEOUT', 'CLINIC_CANCELLED');
CREATE TYPE authorization_channel AS ENUM ('PORTAL', 'PHONE', 'WHATSAPP', 'PHOTO', 'API');
CREATE TYPE authorization_attachment_kind AS ENUM ('QUOTE', 'INSURER_FORM', 'ID_COPY', 'OTHER_ADMIN');

-- Nenhuma coluna de diagnóstico ou clínica (C2, BR-AUT-12; TC-AUT-17).
CREATE TABLE insurer_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  service_id uuid NOT NULL,
  -- Deduzido do serviço (service_kind) à criação e guardado como facto do pedido (BR-AUT-16).
  guide_type text NOT NULL REFERENCES guide_types (code) ON DELETE RESTRICT,
  -- Ligação forte ao processo (ADR-032); sem FK composta por `insurer_id`. Apagar o ato/membro deixa o pedido (BR-PRC-07).
  process_id uuid REFERENCES processes (id) ON DELETE SET NULL,
  parent_request_id uuid,
  status authorization_status NOT NULL DEFAULT 'SUBMITTED',
  closed_reason authorization_closed_reason,
  justification text NOT NULL,
  requested_amount numeric(14, 2) NOT NULL,
  authorized_amount numeric(14, 2),
  expected_on date NOT NULL,
  code text,
  valid_until timestamptz,
  decision_note text,
  decided_by_insurance_account_id uuid REFERENCES insurance_accounts (id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_due_at timestamptz NOT NULL,
  info_expires_at timestamptz,
  submitted_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT insurer_authorizations_insurer_id_id_key UNIQUE (insurer_id, id),
  CONSTRAINT insurer_authorizations_beneficiary_fk FOREIGN KEY (insurer_id, beneficiary_id) REFERENCES insurer_beneficiaries (insurer_id, id),
  CONSTRAINT insurer_authorizations_provider_fk FOREIGN KEY (insurer_id, provider_id) REFERENCES insurer_providers (insurer_id, id),
  CONSTRAINT insurer_authorizations_service_fk FOREIGN KEY (insurer_id, service_id) REFERENCES insurer_services (insurer_id, id),
  CONSTRAINT insurer_authorizations_parent_fk FOREIGN KEY (insurer_id, parent_request_id) REFERENCES insurer_authorizations (insurer_id, id) ON DELETE RESTRICT,
  CONSTRAINT insurer_authorizations_requested_amount_check CHECK (requested_amount > 0),
  CONSTRAINT insurer_authorizations_authorized_amount_check CHECK (authorized_amount IS NULL OR (authorized_amount >= 0 AND authorized_amount <= requested_amount)),
  CONSTRAINT insurer_authorizations_justification_check CHECK (char_length(justification) BETWEEN 1 AND 500),
  CONSTRAINT insurer_authorizations_decision_note_check CHECK (status NOT IN ('REJECTED', 'INFO_REQUESTED') OR decision_note IS NOT NULL),
  CONSTRAINT insurer_authorizations_approved_check CHECK (status <> 'APPROVED' OR (authorized_amount IS NOT NULL AND code IS NOT NULL AND valid_until IS NOT NULL)),
  CONSTRAINT insurer_authorizations_closed_reason_check CHECK ((status = 'CANCELLED') = (closed_reason IS NOT NULL)),
  CONSTRAINT insurer_authorizations_info_expires_check CHECK ((status = 'INFO_REQUESTED') = (info_expires_at IS NOT NULL))
);
-- Código de autorização (≥ 128 bits de entropia, BR-SEG-05).
CREATE UNIQUE INDEX insurer_authorizations_code_idx ON insurer_authorizations (insurer_id, code) WHERE code IS NOT NULL;
-- BR-AUT-09: duplicado em curso (também sob concorrência).
CREATE UNIQUE INDEX insurer_authorizations_open_duplicate_idx ON insurer_authorizations (insurer_id, beneficiary_id, provider_id, service_id, expected_on)
  WHERE status IN ('SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED');
-- BR-AUT-08: um só recurso não cancelado por pedido recusado.
CREATE UNIQUE INDEX insurer_authorizations_one_appeal_idx ON insurer_authorizations (parent_request_id) WHERE parent_request_id IS NOT NULL AND status <> 'CANCELLED';
-- Lista da clínica, factos do processo e job de caducidade (indexes.md).
CREATE INDEX insurer_authorizations_provider_created_idx ON insurer_authorizations (provider_id, created_at DESC, id DESC);
CREATE INDEX insurer_authorizations_process_idx ON insurer_authorizations (process_id) WHERE process_id IS NOT NULL;
CREATE INDEX insurer_authorizations_info_expiry_idx ON insurer_authorizations (info_expires_at) WHERE status = 'INFO_REQUESTED';

-- Histórico funcional, append-only (a aplicação só faz INSERT): não é auditoria.
CREATE TABLE insurer_authorization_events (
  id bigserial PRIMARY KEY,
  insurer_id uuid NOT NULL,
  authorization_id uuid NOT NULL,
  from_status authorization_status,
  to_status authorization_status NOT NULL,
  actor_type actor_type NOT NULL,
  actor_account_id uuid,
  channel authorization_channel NOT NULL,
  note text,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT insurer_authorization_events_authorization_fk FOREIGN KEY (insurer_id, authorization_id) REFERENCES insurer_authorizations (insurer_id, id) ON DELETE CASCADE
);
CREATE INDEX insurer_authorization_events_authorization_idx ON insurer_authorization_events (authorization_id, id);

-- Anexos ADMINISTRATIVOS (BR-AUT-13). Sem `scan_status`: o antivírus corre antes de gravar. Máx. 5 por pedido (aplicação).
CREATE TABLE insurer_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL,
  authorization_id uuid NOT NULL,
  kind authorization_attachment_kind NOT NULL,
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  checksum_sha256 text NOT NULL,
  uploaded_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT insurer_attachments_authorization_fk FOREIGN KEY (insurer_id, authorization_id) REFERENCES insurer_authorizations (insurer_id, id) ON DELETE CASCADE
);
CREATE INDEX insurer_attachments_authorization_idx ON insurer_attachments (authorization_id, created_at);
