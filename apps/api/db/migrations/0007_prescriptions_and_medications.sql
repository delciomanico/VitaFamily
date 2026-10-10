-- Receitas e medicação (schema.md §3, M6/FR-RX/FR-MED): prescriptions, medication_plans,
-- dose_occurrences. FK composta (family_id, member_id) -> family_members(family_id, id) garante
-- isolamento entre famílias (ADR-008, AC-ISO-01). Enums `prescription_status`/`schedule_type`/
-- `plan_status`/`dose_status` já criados em 0001_extensions_and_enums.sql. SQL simples, sem
-- marcadores +goose (ADR-014/ADR-015).

CREATE TABLE prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  issued_on date NOT NULL,
  doctor_name text,
  notes text,
  status prescription_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescriptions_issued_on_not_future CHECK (issued_on <= current_date),
  CONSTRAINT prescriptions_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- Lista por membro/estado (indexes.md).
CREATE INDEX prescriptions_member_status_idx ON prescriptions (member_id, status, issued_on DESC);

-- Plano de toma (BR-MED-01/02, RX-02/05); `prescription_id` nulo = avulso (R7).
CREATE TABLE medication_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  prescription_id uuid REFERENCES prescriptions (id) ON DELETE CASCADE,
  name text NOT NULL,
  dosage text NOT NULL,
  schedule_type schedule_type NOT NULL,
  times text[],
  days_of_week smallint[],
  interval_hours int,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  continuous boolean NOT NULL DEFAULT false,
  notes text,
  status plan_status NOT NULL DEFAULT 'ACTIVE',
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_plans_schedule_shape CHECK (
    (schedule_type = 'FIXED_TIMES' AND cardinality(times) > 0 AND interval_hours IS NULL)
    OR (schedule_type = 'INTERVAL' AND interval_hours BETWEEN 1 AND 168 AND times IS NULL)
  ),
  CONSTRAINT medication_plans_continuous_xor_end_at CHECK (continuous <> (end_at IS NOT NULL)),
  CONSTRAINT medication_plans_end_at_after_start CHECK (end_at > start_at),
  CONSTRAINT medication_plans_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- Medicamentos ativos por membro; planos de uma receita; terminar por duração (indexes.md).
CREATE INDEX medication_plans_member_status_idx ON medication_plans (member_id, status);
CREATE INDEX medication_plans_prescription_idx ON medication_plans (prescription_id);
CREATE INDEX medication_plans_active_end_at_idx ON medication_plans (status, end_at) WHERE status = 'ACTIVE' AND end_at IS NOT NULL;

-- Ocorrência de toma (BR-MED-03/04, DM5: materializada numa janela móvel de 14 dias).
-- `family_id`/`member_id` desnormalizados (schema.md §3) para filtro direto e FK composta, sem
-- depender de um JOIN a `medication_plans` para o isolamento entre famílias.
CREATE TABLE dose_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES medication_plans (id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  status dose_status NOT NULL DEFAULT 'PENDING',
  acted_at timestamptz,
  acted_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  note text,
  generation_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dose_occurrences_plan_scheduled_at_key UNIQUE (plan_id, scheduled_at),
  CONSTRAINT dose_occurrences_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- Scanner de alertas e marcação UNCONFIRMED; agenda do dia/histórico/adesão (indexes.md).
CREATE INDEX dose_occurrences_pending_unconfirmed_idx ON dose_occurrences (status, scheduled_at) WHERE status IN ('PENDING', 'UNCONFIRMED');
CREATE INDEX dose_occurrences_member_scheduled_idx ON dose_occurrences (member_id, scheduled_at DESC);

-- Fase 2 do esquema de `documents` (0006_documents.sql, "DECISÃO DE CHANGE CONTROL"): agora que
-- `prescriptions` existe, liga-se o FK que a migração de M5 deixou pendente — sem ele, apagar uma
-- receita diretamente na BD não cascatearia os seus documentos (a aplicação já cobre isto via
-- `documents.deleteAllForResource`, chamado antes de apagar a receita, prescriptions/application/
-- delete-prescription.ts; o FK é uma segunda rede de segurança ao nível da BD, FR-DOC-04/D15).
ALTER TABLE documents
  ADD CONSTRAINT documents_prescription_fk FOREIGN KEY (prescription_id) REFERENCES prescriptions (id) ON DELETE CASCADE;
