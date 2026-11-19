-- MK3 (ADR-037, schema.md §13, migrations.md «MK3»): marcações, comprovativos de pagamento e avaliações verificadas (módulo
-- `consultations`). `bookings` e `payment_proofs` são do membro (FK composta, CASCADE); `reviews` são anónimas (sem família, membro
-- nem utilizador). `users` só em FK SET NULL de autoria (só servidor). Texto livre = dado potencialmente sensível (BR-MKT-63).
-- Só estrutura nova e alterações aditivas, sem seeds nem backfill. Sem CREATE EXTENSION (btree_gist e citext já existem).
-- SQL simples, sem marcadores +goose.

-- 1) Enums novos (sem ADD VALUE neles); offer_method e scan_status são reutilizados.
CREATE TYPE booking_status AS ENUM ('REQUESTED', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
CREATE TYPE booking_payment_status AS ENUM ('NOT_REQUIRED', 'AWAITING_PROOF', 'PROOF_SUBMITTED', 'CONFIRMED', 'REJECTED', 'DISPUTED');
CREATE TYPE booking_cancelled_by AS ENUM ('FAMILY', 'PROFESSIONAL', 'SYSTEM');
CREATE TYPE booking_system_reason AS ENUM ('REQUEST_EXPIRED', 'PROFESSIONAL_UNAVAILABLE');
CREATE TYPE payment_proof_status AS ENUM ('SUBMITTED', 'CONFIRMED', 'REJECTED', 'DISPUTED', 'REJECTION_UPHELD');
CREATE TYPE payment_dispute_decision AS ENUM ('CONFIRM_PAYMENT', 'UPHOLD_REJECTION');
CREATE TYPE review_report_reason AS ENUM ('ABUSE', 'PERSONAL_DATA', 'OFF_TOPIC', 'OTHER');
CREATE TYPE review_report_status AS ENUM ('OPEN', 'DECIDED');
CREATE TYPE review_report_decision AS ENUM ('DISMISS', 'HIDE_COMMENT');

-- 2) Valores novos de enums existentes; nada nesta migração os usa (mesmo padrão de 0012/0029/0043/0044).
ALTER TYPE process_origin_type ADD VALUE 'BOOKING';
ALTER TYPE alert_type ADD VALUE 'BOOKING_UPDATED';
ALTER TYPE alert_type ADD VALUE 'PAYMENT_UPDATED';
ALTER TYPE alert_source ADD VALUE 'BOOKING';

-- Nota: os CHECK de par «estado <=> campos» comparam cada campo em separado (a forma com AND deixava passar um só campo preenchido).

-- 3) bookings. Os campos copiados da oferta e do horário (preço, duração, método, especialidade, início e fim) são imutáveis
--    (trigger abaixo, BR-MKT-03/51). A FK do horário é NO ACTION (como as regras de MK1): a cascata do profissional não a viola.
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  offer_id uuid NOT NULL,
  specialty_id uuid NOT NULL REFERENCES specialties (id) ON DELETE RESTRICT,
  method offer_method NOT NULL,
  duration_minutes int NOT NULL,
  price_kz int NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  slot_id uuid,
  status booking_status NOT NULL DEFAULT 'REQUESTED',
  payment_status booking_payment_status NOT NULL,
  participant_label text NOT NULL,
  status_reason text,
  cancelled_by booking_cancelled_by,
  system_reason booking_system_reason,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  meeting_info text,
  process_id uuid REFERENCES processes (id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  client_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  CONSTRAINT bookings_offer_fk FOREIGN KEY (professional_id, offer_id)
    REFERENCES professional_offers (professional_id, id) ON DELETE NO ACTION,
  CONSTRAINT bookings_slot_fk FOREIGN KEY (professional_id, slot_id)
    REFERENCES professional_slots (professional_id, id) ON DELETE NO ACTION,
  CONSTRAINT bookings_duration_check CHECK (duration_minutes IN (15, 20, 30, 45, 60)),
  CONSTRAINT bookings_price_check CHECK (price_kz BETWEEN 0 AND 100000000),
  CONSTRAINT bookings_range_check CHECK (ends_at > starts_at),
  CONSTRAINT bookings_label_check CHECK (char_length(btrim(participant_label)) BETWEEN 1 AND 40),
  CONSTRAINT bookings_status_reason_check CHECK (char_length(status_reason) <= 300),
  CONSTRAINT bookings_meeting_info_check CHECK (char_length(meeting_info) <= 300),
  CONSTRAINT bookings_cancelled_check CHECK ((status = 'CANCELLED') = (cancelled_by IS NOT NULL) AND (status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT bookings_system_reason_check CHECK (system_reason IS NULL OR cancelled_by = 'SYSTEM'),
  CONSTRAINT bookings_slot_released_check CHECK ((status IN ('REJECTED', 'CANCELLED')) = (slot_id IS NULL)),
  CONSTRAINT bookings_confirmed_at_check CHECK (status NOT IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW') OR confirmed_at IS NOT NULL),
  CONSTRAINT bookings_completed_at_check CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
  CONSTRAINT bookings_price_payment_check CHECK ((price_kz = 0) = (payment_status = 'NOT_REQUIRED')),
  CONSTRAINT bookings_requested_payment_check CHECK (
    status NOT IN ('REQUESTED', 'REJECTED') OR payment_status IN ('AWAITING_PROOF', 'NOT_REQUIRED')
  ),
  CONSTRAINT bookings_slot_uq UNIQUE (slot_id),
  -- O membro não tem duas marcações ativas sobrepostas.
  CONSTRAINT bookings_member_no_overlap EXCLUDE USING gist (member_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status IN ('REQUESTED', 'CONFIRMED'))
);
CREATE UNIQUE INDEX bookings_process_uq ON bookings (process_id) WHERE process_id IS NOT NULL;
CREATE UNIQUE INDEX bookings_client_request_uq ON bookings (member_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX bookings_member_starts_idx ON bookings (family_id, member_id, starts_at DESC, id DESC);
CREATE INDEX bookings_professional_starts_idx ON bookings (professional_id, starts_at DESC, id DESC);
CREATE INDEX bookings_professional_status_idx ON bookings (professional_id, status, starts_at);
CREATE INDEX bookings_reconcile_idx ON bookings (status, starts_at, created_at) WHERE status IN ('REQUESTED', 'CONFIRMED');
CREATE INDEX bookings_created_by_idx ON bookings (created_by_user_id, created_at DESC) WHERE created_by_user_id IS NOT NULL;

-- Preço e campos copiados não mudam depois de criada a marcação (BR-MKT-03); slot_id só pode passar a nulo.
CREATE FUNCTION bookings_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
     OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
     OR NEW.specialty_id IS DISTINCT FROM OLD.specialty_id
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
     OR NEW.price_kz IS DISTINCT FROM OLD.price_kz
     OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
     OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.slot_id IS NOT NULL AND NEW.slot_id IS DISTINCT FROM OLD.slot_id) THEN
    RAISE EXCEPTION 'bookings: campos copiados da oferta e do horário são imutáveis' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bookings_snapshot_immutable_trg BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_snapshot_immutable();

-- 4) reviews: anónimas (sem family_id/member_id/user_id); a autoria prova-se pela marcação e some com ela (booking_id SET NULL).
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid UNIQUE REFERENCES bookings (id) ON DELETE SET NULL,
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  specialty_id uuid NOT NULL REFERENCES specialties (id) ON DELETE RESTRICT,
  method offer_method NOT NULL,
  consulted_month date NOT NULL,
  rating smallint NOT NULL,
  comment text,
  comment_hidden_at timestamptz,
  reply_text text,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_month_check CHECK (consulted_month = date_trunc('month', consulted_month)::date),
  CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_comment_check CHECK (char_length(comment) <= 500),
  CONSTRAINT reviews_reply_check CHECK (char_length(reply_text) BETWEEN 1 AND 500),
  CONSTRAINT reviews_reply_pair_check CHECK ((reply_text IS NULL) = (replied_at IS NULL))
);
CREATE INDEX reviews_specialty_professional_idx ON reviews (specialty_id, professional_id);
CREATE INDEX reviews_professional_created_idx ON reviews (professional_id, created_at DESC, id DESC);

-- Apagar a marcação (cascata do membro/família) limpa o comentário da avaliação, que fica anónima (BR-MKT-64).
CREATE FUNCTION bookings_clear_review_comment() RETURNS trigger AS $$
BEGIN
  UPDATE reviews SET comment = NULL WHERE booking_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bookings_clear_review_comment_trg BEFORE DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_clear_review_comment();

-- 5) review_reports: uma denúncia por avaliação; não guarda o denunciante.
CREATE TABLE review_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL UNIQUE REFERENCES reviews (id) ON DELETE CASCADE,
  reason review_report_reason NOT NULL,
  note text,
  status review_report_status NOT NULL DEFAULT 'OPEN',
  decision review_report_decision,
  decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_reports_note_check CHECK (char_length(note) <= 300),
  CONSTRAINT review_reports_decided_check CHECK ((status = 'DECIDED') = (decision IS NOT NULL) AND (status = 'DECIDED') = (decided_at IS NOT NULL))
);
CREATE INDEX review_reports_open_idx ON review_reports (status, created_at, id) WHERE status = 'OPEN';

-- 6) consultation_file_deletions: outbox de ficheiros, sem FK (sobrevive à eliminação da marcação).
CREATE TABLE consultation_file_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consultation_file_deletions_pending_idx ON consultation_file_deletions (created_at) WHERE deleted_at IS NULL;

-- 7) payment_proofs (sem updated_at; só muda por decisões).
CREATE TABLE payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  uploaded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes int NOT NULL,
  scan_status scan_status NOT NULL DEFAULT 'PENDING',
  scanned_at timestamptz,
  status payment_proof_status NOT NULL DEFAULT 'SUBMITTED',
  decided_at timestamptz,
  decision_reason text,
  disputed_at timestamptz,
  dispute_note text,
  dispute_decision payment_dispute_decision,
  dispute_decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  dispute_decided_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_proofs_storage_key_uq UNIQUE (storage_key),
  CONSTRAINT payment_proofs_content_type_check CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT payment_proofs_size_check CHECK (size_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT payment_proofs_reason_check CHECK (char_length(decision_reason) <= 300),
  CONSTRAINT payment_proofs_dispute_note_check CHECK (char_length(dispute_note) <= 300),
  CONSTRAINT payment_proofs_submitted_check CHECK (status <> 'SUBMITTED' OR (decided_at IS NULL AND disputed_at IS NULL)),
  CONSTRAINT payment_proofs_decided_check CHECK (
    status NOT IN ('CONFIRMED', 'REJECTED', 'DISPUTED', 'REJECTION_UPHELD') OR decided_at IS NOT NULL
  ),
  CONSTRAINT payment_proofs_reason_required_check CHECK (
    status NOT IN ('REJECTED', 'DISPUTED', 'REJECTION_UPHELD') OR decision_reason IS NOT NULL
  ),
  CONSTRAINT payment_proofs_disputed_check CHECK (status NOT IN ('DISPUTED', 'REJECTION_UPHELD') OR disputed_at IS NOT NULL),
  CONSTRAINT payment_proofs_dispute_pair_check CHECK ((dispute_decision IS NOT NULL) = (dispute_decided_at IS NOT NULL)),
  CONSTRAINT payment_proofs_upheld_check CHECK ((status = 'REJECTION_UPHELD') = (dispute_decision IS NOT DISTINCT FROM 'UPHOLD_REJECTION')),
  CONSTRAINT payment_proofs_confirm_check CHECK (dispute_decision IS DISTINCT FROM 'CONFIRM_PAYMENT' OR status = 'CONFIRMED'),
  CONSTRAINT payment_proofs_disputed_open_check CHECK (status <> 'DISPUTED' OR dispute_decision IS NULL)
);
-- Um só comprovativo em curso por marcação (o máximo de 5 valida-se no serviço, sob o bloqueio da marcação).
CREATE UNIQUE INDEX payment_proofs_in_progress_uq ON payment_proofs (booking_id) WHERE status IN ('SUBMITTED', 'DISPUTED');
CREATE INDEX payment_proofs_booking_created_idx ON payment_proofs (booking_id, created_at DESC);
CREATE INDEX payment_proofs_disputed_idx ON payment_proofs (status, disputed_at, id) WHERE status = 'DISPUTED';
CREATE INDEX payment_proofs_retention_idx ON payment_proofs (created_at) WHERE purged_at IS NULL;

-- Primeiro trigger de outbox do projeto: o ficheiro é apagado também na cascata do membro/família/profissional (OP-99).
CREATE FUNCTION payment_proofs_enqueue_file() RETURNS trigger AS $$
BEGIN
  IF OLD.purged_at IS NULL THEN
    INSERT INTO consultation_file_deletions (storage_key) VALUES (OLD.storage_key);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_proofs_enqueue_file_trg AFTER DELETE ON payment_proofs
  FOR EACH ROW EXECUTE FUNCTION payment_proofs_enqueue_file();

-- 8) Colunas novas em tabelas de outros módulos (nulas nas linhas existentes: nenhum horário fica ocupado).
ALTER TABLE professional_slots
  ADD COLUMN booking_id uuid UNIQUE REFERENCES bookings (id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX professional_slots_free_idx ON professional_slots (professional_id, starts_at) WHERE booking_id IS NULL;

ALTER TABLE appointments ADD COLUMN booking_id uuid REFERENCES bookings (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX appointments_booking_uq ON appointments (booking_id) WHERE booking_id IS NOT NULL;
