-- M14 R (ADR-026, BR-CLN-31..40, schema.md §3f): recibos internos não fiscais da clínica, perfil da clínica, papel
-- `CLINIC_DOCTOR` e auditoria da própria clínica (`audit_logs.actor_clinic_id`). Única migração, transacional e
-- retrocompatível (padrão expand): nenhuma linha existente muda de significado.
-- `ADD VALUE` numa transação (PostgreSQL >= 12) é permitido desde que o valor novo não seja usado na mesma transação:
-- a CHECK de `clinic_accounts` compara `role::text` (não o literal do enum) e nenhum índice o referencia.
ALTER TYPE clinic_account_role ADD VALUE 'CLINIC_DOCTOR';

CREATE TYPE receipt_booking_kind AS ENUM ('APPOINTMENT', 'EXAM', 'VISIT');
CREATE TYPE clinic_receipt_status AS ENUM ('ISSUED', 'VOIDED');
CREATE TYPE receipt_payment_method AS ENUM ('CASH', 'CARD', 'TRANSFER', 'INSURANCE');

-- BR-CLN-32: uma linha por clínica; `INSERT … ON CONFLICT DO UPDATE … RETURNING` na transação do recibo serializa
-- emissões concorrentes e o número volta atrás se a transação falha (sem buracos).
CREATE TABLE clinic_receipt_counters (
  clinic_id uuid PRIMARY KEY REFERENCES clinics (id) ON DELETE CASCADE,
  last_number int NOT NULL DEFAULT 0,
  CONSTRAINT clinic_receipt_counters_last_number_check CHECK (last_number >= 0)
);

-- Recibos são registo da clínica (BR-CLN-24): `booking_id` é um uuid simples (sem FK) para sobreviverem ao apagamento
-- Vita; a única ponte para ids Vita é `clinic_receipt_links`.
CREATE TABLE clinic_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  number int NOT NULL,
  booking_kind receipt_booking_kind NOT NULL,
  booking_id uuid NOT NULL,
  status clinic_receipt_status NOT NULL DEFAULT 'ISSUED',
  payment_method receipt_payment_method NOT NULL,
  currency char(3) NOT NULL,
  total_minor bigint NOT NULL,
  patient_name text NOT NULL,
  note text,
  issuer jsonb NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_reason text,
  voided_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  CONSTRAINT clinic_receipts_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT clinic_receipts_clinic_number_key UNIQUE (clinic_id, number),
  CONSTRAINT clinic_receipts_number_check CHECK (number > 0),
  CONSTRAINT clinic_receipts_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT clinic_receipts_total_check CHECK (total_minor > 0 AND total_minor <= 100000000000),
  CONSTRAINT clinic_receipts_patient_name_check CHECK (char_length(patient_name) BETWEEN 1 AND 120),
  CONSTRAINT clinic_receipts_note_check CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT clinic_receipts_void_reason_check CHECK (void_reason IS NULL OR char_length(void_reason) BETWEEN 3 AND 200),
  CONSTRAINT clinic_receipts_voided_check CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
-- BR-CLN-31: um só recibo ISSUED por marcação (depois de anulado pode emitir-se outro).
CREATE UNIQUE INDEX clinic_receipts_booking_issued_uq ON clinic_receipts (clinic_id, booking_kind, booking_id) WHERE status = 'ISSUED';
CREATE INDEX clinic_receipts_clinic_issued_idx ON clinic_receipts (clinic_id, issued_at DESC, id DESC);

CREATE TABLE clinic_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  position smallint NOT NULL,
  description text NOT NULL,
  amount_minor bigint NOT NULL,
  service_type_id uuid,
  CONSTRAINT clinic_receipt_lines_receipt_fk FOREIGN KEY (clinic_id, receipt_id) REFERENCES clinic_receipts (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT clinic_receipt_lines_service_fk FOREIGN KEY (clinic_id, service_type_id) REFERENCES clinic_service_types (clinic_id, id),
  CONSTRAINT clinic_receipt_lines_position_check CHECK (position BETWEEN 1 AND 20),
  CONSTRAINT clinic_receipt_lines_description_check CHECK (char_length(description) BETWEEN 1 AND 120),
  CONSTRAINT clinic_receipt_lines_amount_check CHECK (amount_minor BETWEEN 0 AND 100000000000),
  CONSTRAINT clinic_receipt_lines_receipt_position_key UNIQUE (receipt_id, position)
);

-- Ponte de leitura para o paciente Vita (BR-CLN-35). Apagar o membro/família apaga só a ligação (BR-CLN-24).
CREATE TABLE clinic_receipt_links (
  receipt_id uuid PRIMARY KEY REFERENCES clinic_receipts (id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_receipt_links_member_fk FOREIGN KEY (family_id, member_id) REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
CREATE INDEX clinic_receipt_links_member_idx ON clinic_receipt_links (member_id, created_at DESC);

-- BR-CLN-36: associação simples recibo <-> pedido de reembolso (como `reimbursement_claim_documents`).
CREATE TABLE reimbursement_claim_receipts (
  claim_id uuid NOT NULL REFERENCES reimbursement_claims (id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES clinic_receipts (id) ON DELETE CASCADE,
  PRIMARY KEY (claim_id, receipt_id)
);
CREATE INDEX reimbursement_claim_receipts_receipt_idx ON reimbursement_claim_receipts (receipt_id);

-- BR-CLN-39: papel `CLINIC_DOCTOR` ligado a um profissional ativo do catálogo (uma conta por profissional).
ALTER TABLE clinic_accounts
  ADD COLUMN professional_id uuid,
  ADD CONSTRAINT clinic_accounts_professional_fk FOREIGN KEY (clinic_id, professional_id) REFERENCES clinic_professionals (clinic_id, id),
  ADD CONSTRAINT clinic_accounts_doctor_professional_check CHECK ((role::text = 'CLINIC_DOCTOR') = (professional_id IS NOT NULL));
CREATE UNIQUE INDEX clinic_accounts_professional_uq ON clinic_accounts (professional_id) WHERE professional_id IS NOT NULL;

-- BR-CLN-38: perfil da clínica (texto institucional); `address`/`phone`/`email` já existem.
ALTER TABLE clinics
  ADD COLUMN display_name text,
  ADD COLUMN description text,
  ADD COLUMN opening_hours text,
  ADD CONSTRAINT clinics_display_name_check CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 120),
  ADD CONSTRAINT clinics_description_check CHECK (description IS NULL OR char_length(description) <= 500),
  ADD CONSTRAINT clinics_opening_hours_check CHECK (opening_hours IS NULL OR char_length(opening_hours) <= 500);

-- BR-CLN-40: auditoria da própria clínica. Sem FK (sobrevive à eliminação). O backfill é a única escrita em linhas
-- existentes (corre com o papel dono da migração; a aplicação continua só com INSERT, audit.md regra 1).
ALTER TABLE audit_logs ADD COLUMN actor_clinic_id uuid;
UPDATE audit_logs a SET actor_clinic_id = c.clinic_id FROM clinic_accounts c WHERE a.actor_type = 'CLINIC_ACCOUNT' AND a.actor_clinic_account_id = c.id;
CREATE INDEX audit_logs_actor_clinic_idx ON audit_logs (actor_clinic_id, occurred_at DESC, id DESC) WHERE actor_clinic_id IS NOT NULL;
