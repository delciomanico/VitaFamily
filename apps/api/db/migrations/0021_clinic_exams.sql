-- Exames espelham consultas no portal da clínica (D19/ADR-023, BR-APT-10, BR-CLN-07/08, BR-EXM-05..08;
-- schema.md §3 "clinic_slots"/"examinations"/"documents"). Depende de 0019 (valores novos de
-- `exam_status` já committed). SQL simples, sem marcadores +goose (ADR-014/ADR-015).

-- ClinicSlot.kind (BR-APT-10): `default 'APPOINTMENT'` preserva os horários existentes.
CREATE TYPE clinic_slot_kind AS ENUM ('APPOINTMENT', 'EXAM');
ALTER TABLE clinic_slots ADD COLUMN kind clinic_slot_kind NOT NULL DEFAULT 'APPOINTMENT';
CREATE INDEX clinic_slots_clinic_id_kind_starts_at_idx ON clinic_slots (clinic_id, kind, starts_at);

-- Examination: horário de origem, motivo da clínica e emissão de resultados (espelho de BR-RX-07).
CREATE TYPE exam_issuer AS ENUM ('FAMILY', 'CLINIC');
ALTER TABLE examinations
  ADD COLUMN scheduled_at timestamptz,
  ADD COLUMN slot_id uuid REFERENCES clinic_slots (id) ON DELETE SET NULL,
  ADD COLUMN response_note text,
  ADD COLUMN issued_by exam_issuer NOT NULL DEFAULT 'FAMILY',
  ADD COLUMN issued_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  ADD COLUMN results_issued_at timestamptz,
  ADD COLUMN clinic_result_note text;

ALTER TABLE examinations
  ADD CONSTRAINT examinations_slot_requires_clinic_check CHECK (slot_id IS NULL OR clinic_id IS NOT NULL),
  -- Um pedido só nasce de um horário; REJECTED/CANCELLED toleram `slot_id` NULL após `SET NULL`.
  ADD CONSTRAINT examinations_requested_requires_slot_check CHECK (status <> 'REQUESTED' OR slot_id IS NOT NULL),
  ADD CONSTRAINT examinations_issued_by_clinic_check CHECK ((issued_by = 'CLINIC') = (issued_by_clinic_account_id IS NOT NULL)),
  ADD CONSTRAINT examinations_clinic_result_note_check CHECK (clinic_result_note IS NULL OR issued_by = 'CLINIC');

-- BR-APT-06: um horário aceita uma só marcação ativa de exame (rede de segurança contra corrida).
CREATE UNIQUE INDEX examinations_slot_active_booking_idx ON examinations (slot_id) WHERE status IN ('REQUESTED', 'SCHEDULED');
-- Pedidos/agenda da clínica (indexes.md).
CREATE INDEX examinations_clinic_status_scheduled_idx ON examinations (clinic_id, status, scheduled_at);

-- Documento emitido pela clínica (BR-CLN-08): rastreabilidade, nunca em simultâneo com `uploaded_by`.
ALTER TABLE documents
  ADD COLUMN uploaded_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL;
ALTER TABLE documents
  ADD CONSTRAINT documents_uploader_exclusive_check CHECK (uploaded_by IS NULL OR uploaded_by_clinic_account_id IS NULL),
  ADD CONSTRAINT documents_clinic_upload_examination_only_check CHECK (uploaded_by_clinic_account_id IS NULL OR examination_id IS NOT NULL);
