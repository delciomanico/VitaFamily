-- Identidade e acesso (schema.md §1): users, auth_tokens, sessions, notification_preferences,
-- audit_logs. Migração nova (ADR-014/ADR-015): SQL simples, sem marcadores +goose, aplicada na
-- íntegra pelo runner (db/migrate-runner.ts). Enums já criados em 0001_extensions_and_enums.sql.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  birth_date date NOT NULL,
  timezone text NOT NULL,
  status user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  platform_role platform_role NOT NULL DEFAULT 'NONE',
  email_verified_at timestamptz,
  terms_accepted_version text NOT NULL,
  terms_accepted_at timestamptz NOT NULL,
  suspended_at timestamptz,
  suspension_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_birth_date_not_future CHECK (birth_date <= current_date)
);

-- Tokens de uso único (verificação de e-mail, recuperação de palavra-passe).
CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type auth_token_type NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_id_idx ON auth_tokens (user_id);

-- Sessões com refresh token rotativo (ADR-007); token_chain_id agrupa a cadeia de rotações para
-- deteção de reutilização (AC-ACC-07): linhas revogadas permanecem para essa deteção.
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
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
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_token_chain_id_idx ON sessions (token_chain_id);

CREATE TABLE notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  medication_due boolean NOT NULL DEFAULT true,
  appointment_reminder boolean NOT NULL DEFAULT true,
  exam_reminder boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auditoria (audit.md): append-only (papel da app só com INSERT), nunca em cascata (schema.md §7).
-- actor_user_id sem FK de propósito (sobrevive à eliminação/anonimização do User, D15/ADR-011).
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type actor_type NOT NULL,
  actor_user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  family_id uuid,
  subject_member_id uuid,
  result audit_result NOT NULL,
  ip inet,
  user_agent text,
  request_id text NOT NULL,
  metadata jsonb
);
CREATE INDEX audit_logs_occurred_at_idx ON audit_logs (occurred_at);
CREATE INDEX audit_logs_actor_user_id_idx ON audit_logs (actor_user_id);
CREATE INDEX audit_logs_action_idx ON audit_logs (action);
