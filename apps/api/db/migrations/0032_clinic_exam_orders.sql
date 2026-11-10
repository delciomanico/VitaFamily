-- M15 U (ADR-028, BR-CLN-51..56, schema.md §3h): pedido de exame da clínica (`clinic_exam_orders`, registo da clínica sem FK para
-- a marcação) e ponte para o paciente Vita (`clinic_exam_order_links`). Única migração, transacional e retrocompatível (padrão
-- expand): nenhuma linha existente muda de significado; sem backfill. A declaração de presença (M15 V) não tem tabela.
-- `ADD VALUE` numa transação (PostgreSQL >= 12) é permitido desde que o valor novo não seja usado na mesma transação (mesmo
-- padrão de 0029/0030): nenhum CHECK, índice ou UPDATE desta migração referencia 'EXAM_ORDER_ADDED'.
ALTER TYPE alert_type ADD VALUE 'EXAM_ORDER_ADDED';

CREATE TYPE exam_order_status AS ENUM ('ORDERED', 'SCHEDULED', 'FULFILLED', 'CANCELLED');

-- Registo da clínica (BR-CLN-56): `booking_id` é um uuid simples (consulta Vita ou visita) para o pedido sobreviver ao
-- apagamento Vita; só se apaga com a clínica (cascata). Contém dado de saúde (nome do exame, nota).
CREATE TABLE clinic_exam_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  booking_kind consultation_booking_kind NOT NULL,
  booking_id uuid NOT NULL,
  clinic_patient_id uuid,
  name text NOT NULL,
  service_type_id uuid,
  note text,
  urgent boolean NOT NULL DEFAULT false,
  status exam_order_status NOT NULL DEFAULT 'ORDERED',
  booked_here boolean NOT NULL DEFAULT false,
  patient_name text NOT NULL,
  patient_birth_date date,
  consultation_at timestamptz NOT NULL,
  author_name text NOT NULL,
  author_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_exam_orders_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT clinic_exam_orders_patient_fk FOREIGN KEY (clinic_id, clinic_patient_id) REFERENCES clinic_patients (clinic_id, id),
  CONSTRAINT clinic_exam_orders_service_fk FOREIGN KEY (clinic_id, service_type_id) REFERENCES clinic_service_types (clinic_id, id),
  CONSTRAINT clinic_exam_orders_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT clinic_exam_orders_note_check CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT clinic_exam_orders_patient_name_check CHECK (char_length(patient_name) BETWEEN 1 AND 120),
  CONSTRAINT clinic_exam_orders_author_name_check CHECK (char_length(author_name) BETWEEN 1 AND 120),
  CONSTRAINT clinic_exam_orders_cancelled_check CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT clinic_exam_orders_booked_here_check CHECK (NOT booked_here OR status IN ('SCHEDULED', 'FULFILLED'))
);
CREATE INDEX clinic_exam_orders_booking_idx ON clinic_exam_orders (clinic_id, booking_id) WHERE status <> 'CANCELLED';
CREATE INDEX clinic_exam_orders_patient_idx ON clinic_exam_orders (clinic_id, clinic_patient_id) WHERE clinic_patient_id IS NOT NULL;

-- Ponte para ids Vita (só consultas Vita; nunca exposta pelo portal): apaga-se com o membro/família/consulta, o pedido fica.
CREATE TABLE clinic_exam_order_links (
  order_id uuid PRIMARY KEY REFERENCES clinic_exam_orders (id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  appointment_id uuid NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  examination_id uuid REFERENCES examinations (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_exam_order_links_member_fk FOREIGN KEY (family_id, member_id) REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
CREATE INDEX clinic_exam_order_links_member_idx ON clinic_exam_order_links (family_id, member_id, created_at DESC);
CREATE INDEX clinic_exam_order_links_appointment_idx ON clinic_exam_order_links (appointment_id);
CREATE UNIQUE INDEX clinic_exam_order_links_examination_uq ON clinic_exam_order_links (examination_id) WHERE examination_id IS NOT NULL;
