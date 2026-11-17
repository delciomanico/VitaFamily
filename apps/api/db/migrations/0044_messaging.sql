-- MK2 (ADR-037, schema.md §12, migrations.md «MK2»): conversas (módulo `messaging`). Descoberta, comparação e ranking não têm tabelas.
-- Primeira ponte entre o espaço de identidade da família e o do profissional: FK para family_members e professionals; `users` só em
-- FK SET NULL de autoria (só servidor). Conteúdo das mensagens = dado de saúde potencial (BR-MKT-46). Só estrutura nova, retrocompatível,
-- sem seeds nem backfill. Sem CREATE EXTENSION. SQL simples, sem marcadores +goose.

-- 1) Enums novos (sem ADD VALUE neles).
CREATE TYPE conversation_status AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE conversation_closed_by AS ENUM ('FAMILY', 'PROFESSIONAL', 'SYSTEM');
CREATE TYPE message_side AS ENUM ('FAMILY', 'PROFESSIONAL');
CREATE TYPE message_report_reason AS ENUM ('ABUSE', 'SPAM', 'SCAM_OR_OFF_PLATFORM_PAYMENT', 'SENSITIVE_DATA', 'OTHER');
CREATE TYPE message_report_status AS ENUM ('OPEN', 'DECIDED');
CREATE TYPE message_report_decision AS ENUM ('DISMISS', 'HIDE_MESSAGE', 'HIDE_AND_CLOSE');

-- 2) Valores novos de enums existentes; nada nesta migração os usa (mesmo padrão de 0012/0023/0029/0043).
ALTER TYPE alert_type ADD VALUE 'MESSAGE_RECEIVED';
ALTER TYPE alert_source ADD VALUE 'CONVERSATION';

-- 3) conversations: uma por (membro-sujeito, profissional); apagar o membro/família/profissional apaga a conversa (BR-MKT-45).
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  professional_id uuid NOT NULL REFERENCES professionals (id) ON DELETE CASCADE,
  opened_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  participant_label text NOT NULL,
  status conversation_status NOT NULL DEFAULT 'OPEN',
  closed_by conversation_closed_by,
  closed_at timestamptz,
  last_seq int NOT NULL,
  last_professional_seq int NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL,
  family_read_seq int NOT NULL DEFAULT 0,
  professional_read_seq int NOT NULL DEFAULT 0,
  professional_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  CONSTRAINT conversations_label_check CHECK (char_length(btrim(participant_label)) BETWEEN 1 AND 40),
  CONSTRAINT conversations_closed_check CHECK ((status = 'CLOSED') = (closed_by IS NOT NULL AND closed_at IS NOT NULL)),
  CONSTRAINT conversations_last_seq_check CHECK (last_seq >= 1),
  CONSTRAINT conversations_family_read_check CHECK (family_read_seq BETWEEN 0 AND last_seq),
  CONSTRAINT conversations_professional_read_check CHECK (professional_read_seq BETWEEN 0 AND last_seq),
  CONSTRAINT conversations_last_professional_seq_check CHECK (last_professional_seq BETWEEN 0 AND last_seq),
  CONSTRAINT conversations_pair_uq UNIQUE (family_id, member_id, professional_id)
);

-- 4) messages: imutável (exceto hidden_at e o SET NULL do autor), sem anexos.
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  seq int NOT NULL,
  side message_side NOT NULL,
  sender_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  body text NOT NULL,
  client_message_id uuid,
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_seq_check CHECK (seq >= 1),
  CONSTRAINT messages_body_check CHECK (char_length(body) BETWEEN 1 AND 1000),
  CONSTRAINT messages_sender_side_check CHECK (side = 'FAMILY' OR sender_user_id IS NULL),
  CONSTRAINT messages_conversation_seq_uq UNIQUE (conversation_id, seq)
);
CREATE UNIQUE INDEX messages_client_message_uq ON messages (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL;

CREATE FUNCTION messages_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id = OLD.id
     AND NEW.conversation_id = OLD.conversation_id
     AND NEW.seq = OLD.seq
     AND NEW.side = OLD.side
     AND NEW.body = OLD.body
     AND NEW.client_message_id IS NOT DISTINCT FROM OLD.client_message_id
     AND NEW.created_at = OLD.created_at
     AND (NEW.sender_user_id IS NOT DISTINCT FROM OLD.sender_user_id OR NEW.sender_user_id IS NULL)
     AND (NEW.hidden_at IS NOT DISTINCT FROM OLD.hidden_at OR (OLD.hidden_at IS NULL AND NEW.hidden_at IS NOT NULL)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'messages é imutável' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER messages_immutable_trg BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_immutable();

-- 5) message_reports: uma denúncia por mensagem e lado; não guarda o id do denunciante (minimização).
CREATE TABLE message_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  reporter_side message_side NOT NULL,
  reason message_report_reason NOT NULL,
  note text,
  status message_report_status NOT NULL DEFAULT 'OPEN',
  decision message_report_decision,
  decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_reports_note_check CHECK (char_length(note) <= 300),
  CONSTRAINT message_reports_decided_check CHECK ((status = 'DECIDED') = (decision IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT message_reports_decided_by_check CHECK (decided_by IS NULL OR status = 'DECIDED'),
  CONSTRAINT message_reports_message_side_uq UNIQUE (message_id, reporter_side)
);

-- 6) Índices (indexes.md, MK2).
CREATE INDEX conversations_family_member_idx ON conversations (family_id, member_id, last_message_at DESC, id DESC);
CREATE INDEX conversations_professional_idx ON conversations (professional_id, last_message_at DESC, id DESC);
CREATE INDEX conversations_last_message_idx ON conversations (last_message_at);
CREATE INDEX conversations_opened_by_idx ON conversations (opened_by_user_id, created_at DESC) WHERE opened_by_user_id IS NOT NULL;
CREATE INDEX conversations_open_member_idx ON conversations (family_id, member_id) WHERE status = 'OPEN';
CREATE INDEX messages_side_seq_idx ON messages (conversation_id, side, seq);
CREATE INDEX messages_sender_idx ON messages (sender_user_id, created_at DESC) WHERE sender_user_id IS NOT NULL;
CREATE INDEX message_reports_open_idx ON message_reports (status, created_at, id) WHERE status = 'OPEN';
CREATE INDEX professionals_city_approved_idx ON professionals ((lower(btrim(city)))) WHERE validation_status = 'APPROVED';
