-- Portal da clínica parceira (D17/D18, ADR-020, schema.md §1/§6 v0.2): clinic_accounts,
-- clinic_sessions — identidade TOTALMENTE separada de `users`/`sessions` (sem FK para nenhuma das
-- duas). `audit_logs` ganha `actor_clinic_account_id` e o enum `actor_type` ganha `CLINIC_ACCOUNT`
-- (schema.md §5: "preenchido só quando actor_type='CLINIC_ACCOUNT'"). SQL simples, sem marcadores
-- +goose (ADR-014/ADR-015).

CREATE TYPE clinic_account_role AS ENUM ('CLINIC_ADMIN', 'CLINIC_MANAGER');
CREATE TYPE clinic_account_status AS ENUM ('ACTIVE', 'SUSPENDED');

-- Novo valor do enum existente (0001_extensions_and_enums.sql); nada nesta migração usa o valor
-- na mesma transação, por isso corre dentro do BEGIN/COMMIT do runner sem restrição do Postgres.
ALTER TYPE actor_type ADD VALUE 'CLINIC_ACCOUNT';

-- schema.md §1: CHECK de `clinic_id` referenciar sempre uma clínica type='PARTNER' é garantido no
-- serviço (clinics/application/admin-clinic-root-account.ts via requirePartnerClinic), não na BD
-- (clinics.type não é imutável). UNIQUE parcial: uma única conta CLINIC_ADMIN ativa por clínica
-- (BR-CLN-05).
CREATE TABLE clinic_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role clinic_account_role NOT NULL,
  status clinic_account_status NOT NULL DEFAULT 'ACTIVE',
  created_by_platform_admin uuid REFERENCES users (id) ON DELETE SET NULL,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clinic_accounts_clinic_id_idx ON clinic_accounts (clinic_id);
CREATE UNIQUE INDEX clinic_accounts_single_active_admin_idx ON clinic_accounts (clinic_id)
  WHERE role = 'CLINIC_ADMIN' AND status = 'ACTIVE';

-- Sessões com refresh token rotativo próprio (ADR-020), independentes da cadeia de `sessions` de
-- User; mesmo critério de deteção de reutilização de `sessions` (AC-ACC-07).
CREATE TABLE clinic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_account_id uuid NOT NULL REFERENCES clinic_accounts (id) ON DELETE CASCADE,
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
CREATE INDEX clinic_sessions_clinic_account_id_idx ON clinic_sessions (clinic_account_id);
CREATE INDEX clinic_sessions_token_chain_id_idx ON clinic_sessions (token_chain_id);

-- audit_logs (schema.md §5, D18): actor do portal da clínica, sem FK (sobrevive à eliminação da
-- conta, mesmo critério de `actor_user_id`).
ALTER TABLE audit_logs ADD COLUMN actor_clinic_account_id uuid;
