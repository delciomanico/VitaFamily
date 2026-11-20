-- MK4 (ADR-037, schema.md §14, migrations.md «MK4»): partilha de registos com prazo e visualização única (módulo `record-sharing`) e
-- receita digital (colunas aditivas em `prescriptions`). As partilhas são do membro (FK composta, CASCADE); não se guarda conteúdo
-- dos registos (lê-se na abertura). `users` só em FK SET NULL de autoria (só servidor). `participant_label` = dado potencialmente
-- sensível. Só estrutura nova e alterações aditivas, sem seeds nem backfill. Sem CREATE EXTENSION. SQL simples, sem marcadores +goose.

-- 1) Enums novos (sem ADD VALUE neles); data_category e specialty_category são reutilizados.
CREATE TYPE share_validity AS ENUM ('H24', 'D7', 'D30', 'UNTIL_CONSULTATION_END_PLUS_24H');
CREATE TYPE record_share_status AS ENUM ('ACTIVE', 'REVOKED', 'CONSUMED');

-- 2) Valor novo de enum existente; nada nesta migração o usa (o CHECK de prescriptions compara issued_by::text).
ALTER TYPE prescription_issuer ADD VALUE 'PROFESSIONAL';

-- 3) Categorias sem duplicados (os CHECK não admitem subconsultas; a função é IMMUTABLE).
CREATE FUNCTION record_share_categories_distinct(cats data_category[]) RETURNS boolean AS $$
  SELECT cardinality(cats) = (SELECT count(DISTINCT c) FROM unnest(cats) AS c)
$$ LANGUAGE sql IMMUTABLE;

CREATE TABLE record_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  participant_label text NOT NULL,
  professional_category specialty_category NOT NULL,
  categories data_category[] NOT NULL,
  validity share_validity NOT NULL,
  view_once boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  status record_share_status NOT NULL DEFAULT 'ACTIVE',
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  consumed_at timestamptz,
  view_count int NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  client_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT record_shares_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  CONSTRAINT record_shares_label_check CHECK (char_length(btrim(participant_label)) BETWEEN 1 AND 40),
  CONSTRAINT record_shares_categories_size_check CHECK (cardinality(categories) BETWEEN 1 AND 5),
  CONSTRAINT record_shares_categories_distinct_check CHECK (record_share_categories_distinct(categories)),
  CONSTRAINT record_shares_expiry_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  CONSTRAINT record_shares_revoked_check CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL)),
  CONSTRAINT record_shares_consumed_check CHECK ((status = 'CONSUMED') = (consumed_at IS NOT NULL)),
  CONSTRAINT record_shares_consumed_view_once_check CHECK (status <> 'CONSUMED' OR view_once),
  CONSTRAINT record_shares_view_count_check CHECK (view_count >= 0),
  CONSTRAINT record_shares_last_viewed_check CHECK ((view_count = 0) = (last_viewed_at IS NULL)),
  CONSTRAINT record_shares_consumed_count_check CHECK (status <> 'CONSUMED' OR view_count = 1)
);

-- Idempotência da criação (BR-MKT-77); sem UNIQUE por (membro, profissional, marcação): o limite de 20 ativas é do serviço.
CREATE UNIQUE INDEX record_shares_client_request_uq ON record_shares (member_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- Partilha imutável (BR-MKT-69): só mudam status (ACTIVE -> REVOKED | CONSUMED, nunca de um terminal), revoked_at,
-- revoked_by_user_id, consumed_at, view_count, last_viewed_at, updated_at e os SET NULL de users.
CREATE FUNCTION record_shares_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.participant_label IS DISTINCT FROM OLD.participant_label
     OR NEW.professional_category IS DISTINCT FROM OLD.professional_category
     OR NEW.categories IS DISTINCT FROM OLD.categories
     OR NEW.validity IS DISTINCT FROM OLD.validity
     OR NEW.view_once IS DISTINCT FROM OLD.view_once
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'record_shares: partilha imutável (só estado, contadores e autoria mudam)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'ACTIVE' AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
       OR NEW.view_count IS DISTINCT FROM OLD.view_count
       OR NEW.last_viewed_at IS DISTINCT FROM OLD.last_viewed_at) THEN
    RAISE EXCEPTION 'record_shares: estado terminal não muda' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER record_shares_guard_trg BEFORE UPDATE ON record_shares
  FOR EACH ROW EXECUTE FUNCTION record_shares_guard();

-- Vistas imutáveis (só desaparecem por cascata ou pelo job de retenção). Sem conteúdo, IP nem user agent.
CREATE TABLE record_share_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES record_shares (id) ON DELETE CASCADE,
  view_no int NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  categories data_category[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT record_share_views_no_check CHECK (view_no >= 1),
  CONSTRAINT record_share_views_categories_check CHECK (cardinality(categories) BETWEEN 1 AND 5),
  CONSTRAINT record_share_views_uq UNIQUE (share_id, view_no)
);

CREATE FUNCTION record_share_views_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'record_share_views: vistas são imutáveis' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER record_share_views_immutable_trg BEFORE UPDATE ON record_share_views
  FOR EACH ROW EXECUTE FUNCTION record_share_views_immutable();

-- 4) prescriptions: receita digital (BR-MKT-79..81). A marcação e o autor passam a nulos com a cascata (SET NULL), issued_by mantém-se.
ALTER TABLE prescriptions
  ADD COLUMN issued_by_professional_id uuid REFERENCES professionals (id) ON DELETE SET NULL,
  ADD COLUMN booking_id uuid REFERENCES bookings (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX prescriptions_booking_uq ON prescriptions (booking_id) WHERE booking_id IS NOT NULL;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_professional_origin_check
  CHECK ((issued_by_professional_id IS NULL AND booking_id IS NULL) OR issued_by::text = 'PROFESSIONAL');

-- 5) Índices (indexes.md, MK4).
CREATE INDEX record_shares_member_idx ON record_shares (family_id, member_id, created_at DESC, id DESC);
CREATE INDEX record_shares_professional_idx ON record_shares (professional_id, created_at DESC, id DESC);
CREATE INDEX record_shares_booking_idx ON record_shares (booking_id);
CREATE INDEX record_shares_member_active_idx ON record_shares (member_id) WHERE status = 'ACTIVE';
CREATE INDEX record_shares_expires_idx ON record_shares (expires_at);
CREATE INDEX record_share_views_share_idx ON record_share_views (share_id, viewed_at DESC, id DESC);
