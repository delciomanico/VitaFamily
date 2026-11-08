-- M14 Q (ADR-026, BR-CLN-25..30, BR-ALR-09, schema.md §3e): confirmação ativa de presença, fluxo do dia (chegada/início)
-- e lembrete de retorno, como colunas de `appointments` e `clinic_visits` (sem tabelas novas; apagam-se com a marcação,
-- D15/BR-CLN-24). Padrão expand: tudo retrocompatível (`confirmation_status` com DEFAULT 'PENDING' preenche as linhas
-- existentes; as restantes colunas ficam NULL).
-- `ADD VALUE` numa transação (PostgreSQL >= 12) é permitido desde que o valor novo não seja usado na mesma transação:
-- nenhum CHECK, índice ou UPDATE desta migração referencia 'NO_SHOW' de `clinic_visit_status` nem os `alert_type` novos.
ALTER TYPE clinic_visit_status ADD VALUE 'NO_SHOW';
ALTER TYPE alert_type ADD VALUE 'APPOINTMENT_CONFIRM_REQUEST';
ALTER TYPE alert_type ADD VALUE 'FOLLOWUP_REMINDER';

CREATE TYPE appointment_confirmation_status AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');
CREATE TYPE confirmation_source AS ENUM ('PATIENT', 'CLINIC');

ALTER TABLE appointments
  ADD COLUMN confirmation_status appointment_confirmation_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN confirmation_source confirmation_source,
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN arrived_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN followup_due_on date,
  ADD CONSTRAINT appointments_confirmation_coherence_check CHECK ((confirmation_status = 'CONFIRMED') = (confirmation_source IS NOT NULL AND confirmed_at IS NOT NULL)),
  ADD CONSTRAINT appointments_declined_cancelled_check CHECK (confirmation_status <> 'DECLINED' OR status = 'CANCELLED'),
  ADD CONSTRAINT appointments_started_after_arrived_check CHECK (started_at IS NULL OR (arrived_at IS NOT NULL AND started_at >= arrived_at));

ALTER TABLE clinic_visits
  ADD COLUMN confirmation_status appointment_confirmation_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN confirmation_source confirmation_source,
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN arrived_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN followup_due_on date,
  ADD CONSTRAINT clinic_visits_confirmation_coherence_check CHECK ((confirmation_status = 'CONFIRMED') = (confirmation_source IS NOT NULL AND confirmed_at IS NOT NULL)),
  ADD CONSTRAINT clinic_visits_no_declined_check CHECK (confirmation_status <> 'DECLINED'),
  ADD CONSTRAINT clinic_visits_source_clinic_check CHECK (confirmation_source IS NULL OR confirmation_source = 'CLINIC'),
  ADD CONSTRAINT clinic_visits_started_after_arrived_check CHECK (started_at IS NULL OR (arrived_at IS NOT NULL AND started_at >= arrived_at));

-- indexes.md (M14 Q): agenda/Hoje/relatórios por período, lista de retornos e scanner do pedido de 48 h.
CREATE INDEX appointments_clinic_scheduled_idx ON appointments (clinic_id, scheduled_at) WHERE clinic_id IS NOT NULL;
CREATE INDEX appointments_clinic_followup_idx ON appointments (clinic_id, followup_due_on) WHERE followup_due_on IS NOT NULL;
CREATE INDEX appointments_confirm_scan_idx ON appointments (scheduled_at) WHERE status = 'SCHEDULED' AND confirmation_status = 'PENDING' AND slot_id IS NOT NULL;
CREATE INDEX clinic_visits_clinic_followup_idx ON clinic_visits (clinic_id, followup_due_on) WHERE followup_due_on IS NOT NULL;
