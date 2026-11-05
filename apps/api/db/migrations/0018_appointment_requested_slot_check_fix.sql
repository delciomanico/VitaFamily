-- Correção (ADR-023, migrations.md/schema.md §3 "appointments"): a CHECK de 0016
-- `appointments_requested_rejected_require_slot_check` — `(status IN ('REQUESTED','REJECTED')) = (slot_id IS NOT NULL)` —
-- proibia `SCHEDULED`/`CANCELLED`/`COMPLETED` com `slot_id` (quebrava a confirmação de um pedido) e
-- `REJECTED` depois de um `SET NULL` do horário. A regra real (BR-APT-01/04) é só: um pedido
-- (`REQUESTED`) só nasce de um horário. As migrações aplicadas são imutáveis, por isso corrige-se
-- aqui. SQL simples, sem marcadores +goose (ADR-014/ADR-015).
ALTER TABLE appointments DROP CONSTRAINT appointments_requested_rejected_require_slot_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_requested_requires_slot_check
  CHECK (status <> 'REQUESTED' OR slot_id IS NOT NULL);
