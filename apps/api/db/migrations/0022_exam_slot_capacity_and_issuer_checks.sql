-- ADR-023 revisto (2026-11-04, D19-rev; migrations.md "0022"): exames com vagas e marcação direta,
-- CHECK `issued_by` corrigida e marca permanente do PDF da clínica. Transacional, sem `ADD VALUE`;
-- não edita 0017/0021 (imutáveis). SQL simples, sem marcadores +goose (ADR-014/ADR-015).

-- 1. BR-APT-11: vagas por horário (expand: horários existentes ficam com 1 vaga).
ALTER TABLE clinic_slots
  ADD COLUMN capacity int NOT NULL DEFAULT 1,
  ADD CONSTRAINT clinic_slots_capacity_range_check CHECK (capacity BETWEEN 1 AND 50),
  ADD CONSTRAINT clinic_slots_capacity_kind_check CHECK (kind = 'EXAM' OR capacity = 1);

-- 2. Fluxo de pedidos de exame retirado: linhas existentes passam a CANCELLED; os valores
-- REQUESTED/REJECTED ficam no enum `exam_status` (compatibilidade), mas a CHECK impede-os.
UPDATE examinations
  SET status = 'CANCELLED', response_note = COALESCE(response_note, 'Pedido descontinuado')
  WHERE status IN ('REQUESTED', 'REJECTED');
ALTER TABLE examinations DROP CONSTRAINT examinations_requested_requires_slot_check;
ALTER TABLE examinations
  ADD CONSTRAINT examinations_no_request_flow_check CHECK (status NOT IN ('REQUESTED', 'REJECTED'));
DELETE FROM alerts WHERE type IN ('EXAM_CONFIRMED', 'EXAM_REJECTED');

-- 3. Sem índice único por horário (N vagas): contagem sob SELECT ... FOR UPDATE do horário (aplicação);
-- o mesmo membro não ocupa duas vagas do mesmo horário.
DROP INDEX examinations_slot_active_booking_idx;
CREATE INDEX examinations_slot_scheduled_idx ON examinations (slot_id) WHERE status = 'SCHEDULED';
CREATE UNIQUE INDEX examinations_slot_member_scheduled_uq ON examinations (slot_id, member_id) WHERE status = 'SCHEDULED';

-- 4. CHECK `issued_by`: ON DELETE SET NULL da conta da clínica já não a viola (BR-CLN-05).
ALTER TABLE examinations DROP CONSTRAINT examinations_issued_by_clinic_check;
ALTER TABLE examinations
  ADD CONSTRAINT examinations_issued_by_clinic_check CHECK (issued_by_clinic_account_id IS NULL OR issued_by = 'CLINIC');
ALTER TABLE prescriptions DROP CONSTRAINT prescriptions_issued_by_clinic_check;
ALTER TABLE prescriptions
  ADD CONSTRAINT prescriptions_issued_by_clinic_check CHECK (issued_by_clinic_account_id IS NULL OR issued_by = 'CLINIC');

-- 5. Marca permanente do PDF emitido pela clínica (BR-CLN-08), nunca anulada por SET NULL.
ALTER TABLE documents ADD COLUMN uploaded_by_clinic boolean NOT NULL DEFAULT false;
UPDATE documents d
  SET uploaded_by_clinic = true
  WHERE d.uploaded_by_clinic_account_id IS NOT NULL
     OR (d.uploaded_by IS NULL AND d.examination_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM examinations e
          WHERE e.id = d.examination_id AND (e.scheduled_at IS NOT NULL OR e.issued_by = 'CLINIC')));
ALTER TABLE documents DROP CONSTRAINT documents_clinic_upload_examination_only_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_clinic_account_requires_flag_check CHECK (uploaded_by_clinic_account_id IS NULL OR uploaded_by_clinic),
  ADD CONSTRAINT documents_clinic_upload_examination_only_check CHECK (NOT uploaded_by_clinic OR (examination_id IS NOT NULL AND uploaded_by IS NULL));

-- 6. CHECK do resultado da consulta: ON DELETE SET NULL da conta da clínica já não a viola.
UPDATE appointments SET outcome_recorded_at = COALESCE(outcome_recorded_at, now()) WHERE clinic_outcome_note IS NOT NULL;
ALTER TABLE appointments DROP CONSTRAINT appointments_outcome_requires_clinic_account_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_outcome_requires_recorded_at_check CHECK (clinic_outcome_note IS NULL OR outcome_recorded_at IS NOT NULL);
