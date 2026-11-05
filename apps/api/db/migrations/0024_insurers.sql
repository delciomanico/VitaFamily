-- Seguradoras parceiras e portal da seguradora (ADR-021/ADR-023, schema.md §3b): insurer_accounts,
-- insurance_accounts, insurance_sessions — identidade TOTALMENTE separada de `users`/`sessions` e de
-- `clinic_accounts` (sem FK para nenhuma delas, exceto `created_by*` -> users SET NULL, como em
-- `clinics`/`clinic_accounts`). Mirror de 0012_clinic_accounts.sql. `apólices`/`pedidos` ficam para a
-- Fase 4b. `audit_logs` ganha `actor_insurance_account_id` e `actor_type` ganha `INSURANCE_ACCOUNT`.

CREATE TYPE insurer_status AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE insurance_account_role AS ENUM ('INSURANCE_ADMIN', 'INSURANCE_AGENT');
CREATE TYPE insurance_account_status AS ENUM ('ACTIVE', 'SUSPENDED');

-- Novo valor do enum existente (0001/0012); nada nesta migração o usa na mesma transação.
ALTER TYPE actor_type ADD VALUE 'INSURANCE_ACCOUNT';

CREATE TABLE insurer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tax_id text NOT NULL UNIQUE,
  status insurer_status NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE insurance_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE CASCADE,
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role insurance_account_role NOT NULL,
  status insurance_account_status NOT NULL DEFAULT 'ACTIVE',
  created_by_platform_admin uuid REFERENCES users (id) ON DELETE SET NULL,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX insurance_accounts_insurer_id_idx ON insurance_accounts (insurer_id);
-- BR-INS-06: uma única conta INSURANCE_ADMIN ativa por seguradora.
CREATE UNIQUE INDEX insurance_accounts_single_active_admin_idx ON insurance_accounts (insurer_id)
  WHERE role = 'INSURANCE_ADMIN' AND status = 'ACTIVE';

CREATE TABLE insurance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurance_account_id uuid NOT NULL REFERENCES insurance_accounts (id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  token_chain_id uuid NOT NULL,
  user_agent text,
  ip inet,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX insurance_sessions_account_id_idx ON insurance_sessions (insurance_account_id);
CREATE INDEX insurance_sessions_token_chain_id_idx ON insurance_sessions (token_chain_id);

-- schema.md §5: sem FK (sobrevive à eliminação da conta); preenchido só com actor_type='INSURANCE_ACCOUNT'.
ALTER TABLE audit_logs ADD COLUMN actor_insurance_account_id uuid;
