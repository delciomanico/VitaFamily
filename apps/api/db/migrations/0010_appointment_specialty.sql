-- Especialidade da consulta (change control: pedido do proprietário, ver docs/04-domain/entities.md
-- → Appointment). Texto livre, opcional; consultas existentes ficam sem especialidade.
-- SQL simples, sem marcadores +goose (ADR-014/ADR-015).
ALTER TABLE appointments ADD COLUMN specialty text;
