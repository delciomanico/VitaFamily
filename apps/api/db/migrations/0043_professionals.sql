-- MK1 (ADR-037, schema.md §11, migrations.md «MK1»): mercado de profissionais. Espaço de identidade SEPARADO (BR-MKT-13): sem FK
-- para users/family_members/clinic_accounts, exceto validation_cases.decided_by -> users (SET NULL, só o id do admin). Sem dados de
-- saúde nem ids de famílias (BR-MKT-27). Só estrutura nova, retrocompatível, sem seeds nem backfill (OP-68: o catálogo de
-- especialidades é carregado pelo admin). Sem CREATE EXTENSION (citext em 0001, btree_gist em 0027). SQL simples, sem marcadores +goose.

-- 1) Enums novos (sem ADD VALUE neles); reutilizam-se auth_token_type e scan_status.
CREATE TYPE professional_account_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE');
CREATE TYPE professional_validation_status AS ENUM ('DRAFT', 'PENDING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE specialty_category AS ENUM ('HEALTH', 'WELLNESS');
CREATE TYPE credential_kind AS ENUM ('IDENTITY', 'PROFESSIONAL_LICENSE', 'CERTIFICATION');
CREATE TYPE validation_action AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'NEEDS_INFO', 'SUSPENDED', 'REACTIVATED', 'EXPIRED');
CREATE TYPE validation_actor AS ENUM ('PROFESSIONAL', 'PLATFORM_ADMIN', 'SYSTEM');
CREATE TYPE offer_method AS ENUM ('IN_PERSON', 'VIDEO', 'CHAT', 'PHONE');

-- 2) Novo valor do enum existente; nada nesta migração o usa (mesmo padrão de 0012/0029/0030/0041).
ALTER TYPE actor_type ADD VALUE 'PROFESSIONAL_ACCOUNT';

-- 3) Identidade própria (equivalente a clinic_accounts/clinic_sessions; cadeias de sessão independentes).
CREATE TABLE professional_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status professional_account_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  email_verified_at timestamptz,
  terms_accepted_version text NOT NULL,
  terms_accepted_at timestamptz NOT NULL,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_accounts_active_verified_check CHECK (status <> 'ACTIVE' OR email_verified_at IS NOT NULL)
);

CREATE TABLE professional_auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES professional_accounts (id) ON DELETE CASCADE,
  type auth_token_type NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX professional_auth_tokens_account_type_idx ON professional_auth_tokens (account_id, type);

CREATE TABLE professional_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES professional_accounts (id) ON DELETE CASCADE,
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
CREATE INDEX professional_sessions_token_chain_id_idx ON professional_sessions (token_chain_id);
CREATE INDEX professional_sessions_account_id_idx ON professional_sessions (account_id);

-- 4) Perfil e estado de validação (a categoria deriva-se das especialidades, BR-MKT-16: sem coluna).
CREATE TABLE professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES professional_accounts (id) ON DELETE CASCADE,
  display_name text,
  bio text,
  city text,
  payment_instructions text,
  validation_status professional_validation_status NOT NULL DEFAULT 'DRAFT',
  status_reason text,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professionals_display_name_check CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 2 AND 120),
  CONSTRAINT professionals_bio_check CHECK (char_length(bio) <= 1000),
  CONSTRAINT professionals_city_check CHECK (city IS NULL OR char_length(city) BETWEEN 2 AND 80),
  CONSTRAINT professionals_payment_instructions_check CHECK (char_length(payment_instructions) <= 500),
  CONSTRAINT professionals_status_reason_check CHECK (char_length(status_reason) <= 500),
  CONSTRAINT professionals_submitted_after_draft_check CHECK (
    validation_status NOT IN ('PENDING_REVIEW', 'APPROVED', 'NEEDS_INFO', 'REJECTED', 'SUSPENDED') OR submitted_at IS NOT NULL
  ),
  CONSTRAINT professionals_approved_complete_check CHECK (
    validation_status <> 'APPROVED' OR (display_name IS NOT NULL AND city IS NOT NULL AND approved_at IS NOT NULL)
  )
);
CREATE INDEX professionals_queue_idx ON professionals (validation_status, submitted_at, id);
CREATE INDEX professionals_approved_idx ON professionals (id) WHERE validation_status = 'APPROVED';

-- 5) Catálogo de especialidades (nunca se apagam: RESTRICT; desativam-se). Imutabilidade de category: no serviço.
CREATE TABLE specialties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category specialty_category NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT specialties_name_check CHECK (char_length(name) BETWEEN 2 AND 80)
);
CREATE UNIQUE INDEX specialties_name_lower_uq ON specialties (lower(name));
CREATE INDEX specialties_active_name_idx ON specialties (active, name);

CREATE TABLE professional_specialties (
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  specialty_id uuid NOT NULL REFERENCES specialties (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (professional_id, specialty_id)
);
CREATE INDEX professional_specialties_specialty_idx ON professional_specialties (specialty_id);

-- 6) Outbox de ficheiros próprio (OP-58): sem FK (sobrevive à eliminação do profissional/conta).
CREATE TABLE professional_file_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX professional_file_deletions_pending_idx ON professional_file_deletions (deleted_at, created_at) WHERE deleted_at IS NULL;

CREATE TABLE professional_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  kind credential_kind NOT NULL,
  number text,
  issuing_body text,
  valid_until date,
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size_bytes int NOT NULL,
  scan_status scan_status NOT NULL DEFAULT 'PENDING',
  scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_credentials_number_check CHECK (char_length(number) <= 60),
  CONSTRAINT professional_credentials_issuing_body_check CHECK (char_length(issuing_body) <= 120),
  CONSTRAINT professional_credentials_content_type_check CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT professional_credentials_size_bytes_check CHECK (size_bytes BETWEEN 1 AND 10485760)
);
CREATE INDEX professional_credentials_professional_kind_idx ON professional_credentials (professional_id, kind);
CREATE INDEX professional_credentials_expiry_idx ON professional_credentials (valid_until)
  WHERE valid_until IS NOT NULL AND scan_status = 'CLEAN';

-- 7) Histórico de validação, IMUTÁVEL (sem updated_at). decided_by -> users SET NULL (RGPD: o admin pode ser apagado).
CREATE TABLE validation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  action validation_action NOT NULL,
  from_status professional_validation_status NOT NULL,
  to_status professional_validation_status NOT NULL,
  actor validation_actor NOT NULL,
  decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validation_cases_reason_check CHECK (char_length(reason) <= 500),
  CONSTRAINT validation_cases_reason_required_check CHECK (
    action NOT IN ('REJECTED', 'NEEDS_INFO', 'SUSPENDED', 'EXPIRED') OR reason IS NOT NULL
  ),
  CONSTRAINT validation_cases_decided_by_actor_check CHECK (actor = 'PLATFORM_ADMIN' OR decided_by IS NULL)
);
CREATE INDEX validation_cases_professional_idx ON validation_cases (professional_id, created_at DESC, id DESC);

-- Qualquer UPDATE é rejeitado, exceto decided_by -> NULL com tudo o resto igual (o efeito de ON DELETE SET NULL).
CREATE FUNCTION validation_cases_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.decided_by IS NULL
     AND NEW.id = OLD.id
     AND NEW.professional_id = OLD.professional_id
     AND NEW.action = OLD.action
     AND NEW.from_status = OLD.from_status
     AND NEW.to_status = OLD.to_status
     AND NEW.actor = OLD.actor
     AND NEW.reason IS NOT DISTINCT FROM OLD.reason
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'validation_cases é imutável' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER validation_cases_immutable_trg BEFORE UPDATE ON validation_cases
  FOR EACH ROW EXECUTE FUNCTION validation_cases_immutable();

-- 8) Ofertas: especialidade tem de ser do próprio profissional (FK composta NO ACTION: verificada no fim da instrução, por isso a
--    cascata do profissional não a viola; retirar a especialidade com ofertas falha).
CREATE TABLE professional_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  specialty_id uuid NOT NULL,
  method offer_method NOT NULL,
  duration_minutes int NOT NULL,
  price_kz int NOT NULL,
  note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_offers_specialty_fk FOREIGN KEY (professional_id, specialty_id)
    REFERENCES professional_specialties (professional_id, specialty_id) ON DELETE NO ACTION,
  CONSTRAINT professional_offers_duration_check CHECK (duration_minutes IN (15, 20, 30, 45, 60)),
  CONSTRAINT professional_offers_price_check CHECK (price_kz BETWEEN 0 AND 100000000),
  CONSTRAINT professional_offers_note_check CHECK (char_length(note) <= 200),
  CONSTRAINT professional_offers_professional_id_uq UNIQUE (professional_id, id)
);
CREATE UNIQUE INDEX professional_offers_active_uq ON professional_offers (professional_id, specialty_id, method, duration_minutes) WHERE active;
CREATE INDEX professional_offers_active_idx ON professional_offers (professional_id) WHERE active;

CREATE TABLE professional_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  offer_id uuid NOT NULL,
  weekdays smallint[] NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  valid_from date,
  valid_until date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_schedule_rules_offer_fk FOREIGN KEY (professional_id, offer_id)
    REFERENCES professional_offers (professional_id, id) ON DELETE NO ACTION,
  CONSTRAINT professional_schedule_rules_weekdays_check CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  CONSTRAINT professional_schedule_rules_time_check CHECK (end_time > start_time),
  CONSTRAINT professional_schedule_rules_valid_check CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CONSTRAINT professional_schedule_rules_professional_id_uq UNIQUE (professional_id, id)
);
CREATE INDEX professional_schedule_rules_active_idx ON professional_schedule_rules (professional_id) WHERE active;
CREATE INDEX professional_schedule_rules_offer_idx ON professional_schedule_rules (offer_id);

CREATE TABLE professional_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_time_off_range_check CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '366 days'),
  CONSTRAINT professional_time_off_reason_check CHECK (char_length(reason) <= 200)
);
CREATE INDEX professional_time_off_professional_ends_idx ON professional_time_off (professional_id, ends_at);

CREATE TABLE professional_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  offer_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_slots_offer_fk FOREIGN KEY (professional_id, offer_id)
    REFERENCES professional_offers (professional_id, id) ON DELETE NO ACTION,
  CONSTRAINT professional_slots_rule_fk FOREIGN KEY (professional_id, rule_id)
    REFERENCES professional_schedule_rules (professional_id, id) ON DELETE NO ACTION,
  CONSTRAINT professional_slots_range_check CHECK (ends_at > starts_at),
  CONSTRAINT professional_slots_rule_starts_uq UNIQUE (rule_id, starts_at),
  CONSTRAINT professional_slots_professional_id_uq UNIQUE (professional_id, id),
  CONSTRAINT professional_slots_no_overlap EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
);
CREATE INDEX professional_slots_professional_starts_idx ON professional_slots (professional_id, starts_at);

-- 9) audit_logs: ator do portal do profissional, sem FK (sobrevive à eliminação da conta).
ALTER TABLE audit_logs ADD COLUMN actor_professional_account_id uuid;
