-- Fase E (D18, BR-CLN-06/BR-RX-07): o Gestor da clínica completa a consulta `SCHEDULED` em curso
-- (registar o resultado e, opcionalmente, emitir a receita associada). Colunas anunciadas em 0016
-- (fora do âmbito dessa migração) e já descritas em schema.md §3 ("appointments"/"prescriptions").
-- SQL simples, sem marcadores +goose (ADR-014/ADR-015).

-- `appointments`: resultado da consulta registado pela própria clínica (nunca pela família).
ALTER TABLE appointments
  ADD COLUMN clinic_outcome_note text,
  ADD COLUMN outcome_recorded_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  ADD COLUMN outcome_recorded_at timestamptz;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_outcome_requires_clinic_account_check
  CHECK (clinic_outcome_note IS NULL OR outcome_recorded_by_clinic_account_id IS NOT NULL);

-- `prescriptions`: origem (BR-RX-07) — `issued_by=FAMILY` (default) nas restantes, `CLINIC` quando
-- emitida pelo portal (`completeClinicAppointment`), sempre com a conta e a consulta de origem.
CREATE TYPE prescription_issuer AS ENUM ('FAMILY', 'CLINIC');

ALTER TABLE prescriptions
  ADD COLUMN issued_by prescription_issuer NOT NULL DEFAULT 'FAMILY',
  ADD COLUMN issued_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  ADD COLUMN appointment_id uuid REFERENCES appointments (id) ON DELETE SET NULL;

ALTER TABLE prescriptions
  ADD CONSTRAINT prescriptions_issued_by_clinic_check
  CHECK ((issued_by = 'CLINIC') = (issued_by_clinic_account_id IS NOT NULL AND appointment_id IS NOT NULL));
