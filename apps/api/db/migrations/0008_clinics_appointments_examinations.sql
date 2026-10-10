-- Consultas, clínicas e exames (schema.md §3, M7/FR-APT/FR-EXM/FR-CLN/FR-ADM-01): clinics,
-- appointments, examinations, exam_results. FK composta (family_id, member_id) ->
-- family_members(family_id, id) garante isolamento entre famílias (ADR-008, AC-ISO-01) nas
-- tabelas de membro; `clinics` não tem essa FK (parceiras não têm família, schema.md §3). Enums
-- `appointment_status`/`exam_status`/`clinic_type`/`clinic_status` já criados em
-- 0001_extensions_and_enums.sql. SQL simples, sem marcadores +goose (ADR-014/ADR-015).

-- BR-CLN-01/03: parceiras (family_id nulo) criadas pelo Platform Admin, visíveis a todos;
-- privadas (family_id obrigatório) criadas por um adulto da família, visíveis só a ela.
CREATE TABLE clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type clinic_type NOT NULL,
  family_id uuid REFERENCES families (id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  phone text,
  email text,
  status clinic_status NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinics_private_requires_family CHECK ((type = 'PRIVATE') = (family_id IS NOT NULL))
);
-- Listar parceiras e privadas (indexes.md); limite de 10 privadas por família (B4, contagem direta).
CREATE INDEX clinics_type_status_idx ON clinics (type, status);
CREATE INDEX clinics_family_id_idx ON clinics (family_id) WHERE family_id IS NOT NULL;

-- Appointment (BR-APT-01/02/04, ST4): `clinic_id` + `clinic_name` (snapshot de texto, BR-CLN-02 —
-- sobrevive à edição/arquivo/eliminação da clínica, `ON DELETE SET NULL` só limpa o `clinic_id`).
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status appointment_status NOT NULL DEFAULT 'SCHEDULED',
  professional_name text,
  clinic_id uuid REFERENCES clinics (id) ON DELETE SET NULL,
  clinic_name text,
  reason text,
  notes text,
  outcome_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- Listar por membro/período; scanner de lembretes e de pedido de desfecho (indexes.md, M8).
CREATE INDEX appointments_member_scheduled_idx ON appointments (member_id, scheduled_at);
CREATE INDEX appointments_scheduled_pending_idx ON appointments (status, scheduled_at) WHERE status = 'SCHEDULED';

-- Examination (BR-EXM-04, ST5): mesmo critério de `clinic_id`/`clinic_name` de `appointments`.
CREATE TABLE examinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  name text NOT NULL,
  exam_date date NOT NULL,
  status exam_status NOT NULL DEFAULT 'SCHEDULED',
  clinic_id uuid REFERENCES clinics (id) ON DELETE SET NULL,
  clinic_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT examinations_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- Listar por membro/período; scanner de lembrete 24h (indexes.md, M8).
CREATE INDEX examinations_member_exam_date_idx ON examinations (member_id, exam_date DESC);
CREATE INDEX examinations_scheduled_pending_idx ON examinations (status, exam_date) WHERE status = 'SCHEDULED';

-- ExamResult (BR-EXM-01/02, D11): o sistema nunca interpreta o valor nem sinaliza fora do
-- intervalo — só guarda e devolve o que o utilizador introduziu.
CREATE TABLE exam_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  examination_id uuid NOT NULL REFERENCES examinations (id) ON DELETE CASCADE,
  parameter text NOT NULL,
  value_numeric numeric,
  value_text text,
  unit text,
  reference_min numeric,
  reference_max numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_results_has_value CHECK (value_numeric IS NOT NULL OR value_text IS NOT NULL),
  CONSTRAINT exam_results_reference_range CHECK (reference_min IS NULL OR reference_max IS NULL OR reference_min <= reference_max)
);
-- Resultados de um exame; histórico de um parâmetro ao longo do tempo via join com `examinations` (indexes.md).
CREATE INDEX exam_results_examination_idx ON exam_results (examination_id);
CREATE INDEX exam_results_parameter_idx ON exam_results (parameter);

-- Fase 2 do esquema de `documents` (0006_documents.sql, "DECISÃO DE CHANGE CONTROL", já referida
-- em 0007 para `prescription_id`): agora que `examinations` existe, liga-se o FK que M5 deixou
-- pendente — sem ele, apagar um exame diretamente na BD não cascatearia os seus documentos (a
-- aplicação já cobre isto via `documents.deleteAllForResource`, chamado antes de apagar o exame,
-- examinations/application/delete-examination.ts; o FK é uma segunda rede de segurança ao nível
-- da BD, FR-DOC-04/D15).
ALTER TABLE documents
  ADD CONSTRAINT documents_examination_fk FOREIGN KEY (examination_id) REFERENCES examinations (id) ON DELETE CASCADE;
