-- Portal da clínica parceira (D17, Fase D): liga `appointments` a `clinic_slots` (BR-APT-04/06,
-- schema.md §4). `response_note` guarda o motivo da clínica ao recusar um pedido ou cancelar uma
-- consulta confirmada (D17). As colunas de resultado da consulta/receita (BR-CLN-06, D18:
-- `clinic_outcome_note`, `outcome_recorded_by_clinic_account_id`, `outcome_recorded_at`) ficam
-- para a Fase E (módulo prescriptions/health-records) — fora do âmbito desta migração.
-- SQL simples, sem marcadores +goose (ADR-014/ADR-015).
ALTER TABLE appointments
  ADD COLUMN slot_id uuid REFERENCES clinic_slots (id) ON DELETE SET NULL,
  ADD COLUMN response_note text;

-- BR-APT-01/04: REQUESTED/REJECTED só existem numa consulta de clínica parceira originada por um
-- horário publicado; as restantes nunca têm slot_id.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_slot_requires_clinic_check CHECK (slot_id IS NULL OR clinic_id IS NOT NULL);
ALTER TABLE appointments
  ADD CONSTRAINT appointments_requested_rejected_require_slot_check
  CHECK ((status IN ('REQUESTED', 'REJECTED')) = (slot_id IS NOT NULL));

-- BR-APT-06: um horário aceita uma única marcação ativa (PEDIDA ou AGENDADA) — rede de segurança
-- final contra corrida (o pré-cheque na aplicação é a primeira linha de defesa, mas esta UNIQUE
-- parcial garante a invariante mesmo sob concorrência).
CREATE UNIQUE INDEX appointments_slot_active_booking_idx ON appointments (slot_id) WHERE status IN ('REQUESTED', 'SCHEDULED');
