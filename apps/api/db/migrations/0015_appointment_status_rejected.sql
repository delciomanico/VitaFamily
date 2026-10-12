-- Portal da clínica parceira (D17, Fase D): novo estado `REJECTED` de `appointment_status`
-- (state-machines.md "Appointment", schema.md §7) — ver 0014 sobre a separação em migrações
-- distintas. SQL simples, sem marcadores +goose (ADR-014/ADR-015).
ALTER TYPE appointment_status ADD VALUE 'REJECTED';
