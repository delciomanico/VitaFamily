-- Marcação presencial pela clínica (D20, ADR-024, BR-CLN-10): `walk_in` é a marca permanente de que a
-- consulta foi marcada presencialmente pela clínica; `booked_by_clinic_account_id` é o autor
-- (ON DELETE SET NULL ao remover a conta; a marca `walk_in` mantém-se). SQL simples (ADR-014/015).
ALTER TABLE appointments
  ADD COLUMN walk_in boolean NOT NULL DEFAULT false,
  ADD COLUMN booked_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL;

-- Autor só existe numa consulta walk-in (a recíproca não é exigida: SET NULL anula o autor).
ALTER TABLE appointments
  ADD CONSTRAINT appointments_booked_by_clinic_requires_walk_in_check
  CHECK (booked_by_clinic_account_id IS NULL OR walk_in);
