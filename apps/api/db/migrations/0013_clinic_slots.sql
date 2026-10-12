-- ClinicSlot (schema.md §3 v0.2, D17/D18, BR-CLN-04/UC-CLN-04): horários publicados pelo Gestor
-- da clínica parceira (Fase C do Portal da Clínica). "Livre" (schema.md §3: "sem
-- appointments.slot_id com status em (REQUESTED, SCHEDULED)") só é calculável quando o módulo
-- appointments ganhar a coluna slot_id (Fase D, ainda não implementada) — esta migração cria só
-- `clinic_slots`, sem nenhuma FK de appointments para aqui (essa liga-se na Fase D). SQL simples,
-- sem marcadores +goose (ADR-014/ADR-015).
CREATE TABLE clinic_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  specialty text NOT NULL,
  professional_name text,
  starts_at timestamptz NOT NULL,
  duration_minutes int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_slots_duration_minutes_check CHECK (duration_minutes IN (15, 20, 30, 45, 60))
);
-- Listar/paginar os horários de uma clínica por período (endpoints.md listOwnClinicSlots).
CREATE INDEX clinic_slots_clinic_id_starts_at_idx ON clinic_slots (clinic_id, starts_at);
