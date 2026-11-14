-- Processos (marco B fatia 1, ADR-032; schema.md §4b, migrations.md "0036_processes.sql", BR-PRC-01/07/08).
-- Expand + backfill numa só migração pequena. SQL simples, sem triggers nem lógica em defaults:
-- `family_status`/`nextStep` NÃO são colunas (derivam em leitura de `deriveFamilyStatus`, BR-PRC-02).
-- `process_id` fica NULLABLE nas duas tabelas de atos; o NOT NULL é uma migração posterior, só depois
-- de o backfill ser verificado em cópia de dados reais. Os enums nascem completos (sem `ADD VALUE`).
CREATE TYPE process_kind AS ENUM ('ROUTINE');
CREATE TYPE process_origin_type AS ENUM ('APPOINTMENT', 'EXAMINATION');

CREATE TABLE processes (
  -- `id` = `processId`; a aplicação gera-o com `newId()`. O default só serve o backfill abaixo.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  kind process_kind NOT NULL,
  origin_type process_origin_type NOT NULL,
  -- Id do ato âncora; sem FK por ser polimórfico (a ligação forte é `*.process_id`, abaixo).
  origin_id uuid NOT NULL,
  -- Clínica do ato no momento da abertura; nulo em atos sem clínica Vita.
  clinic_id uuid REFERENCES clinics (id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL,
  -- Isolamento por família e cascata com o membro/família (D15, ADR-008, BR-PRC-07).
  CONSTRAINT processes_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  -- BR-PRC-01: um só processo por ato (idempotência de `open`).
  CONSTRAINT processes_origin_unique UNIQUE (origin_type, origin_id)
);
-- Lista da família (BR-PRC-05) e leitura da clínica (BR-PRC-06).
CREATE INDEX processes_member_opened_idx ON processes (family_id, member_id, opened_at DESC, id DESC);
CREATE INDEX processes_clinic_idx ON processes (clinic_id) WHERE clinic_id IS NOT NULL;

ALTER TABLE appointments ADD COLUMN process_id uuid REFERENCES processes (id) ON DELETE SET NULL;
ALTER TABLE examinations ADD COLUMN process_id uuid REFERENCES processes (id) ON DELETE SET NULL;
-- 1 ato : 1 processo nesta fatia.
CREATE UNIQUE INDEX appointments_process_unique_idx ON appointments (process_id) WHERE process_id IS NOT NULL;
CREATE UNIQUE INDEX examinations_process_unique_idx ON examinations (process_id) WHERE process_id IS NOT NULL;

-- Backfill idempotente (BR-PRC-08): voltar a correr não duplica nem altera (ON CONFLICT + `process_id IS NULL`).
INSERT INTO processes (family_id, member_id, kind, origin_type, origin_id, clinic_id, opened_at)
SELECT a.family_id, a.member_id, 'ROUTINE', 'APPOINTMENT', a.id, a.clinic_id, a.created_at
FROM appointments a
WHERE a.process_id IS NULL
ON CONFLICT (origin_type, origin_id) DO NOTHING;

UPDATE appointments a
SET process_id = p.id
FROM processes p
WHERE p.origin_type = 'APPOINTMENT' AND p.origin_id = a.id AND a.process_id IS NULL;

INSERT INTO processes (family_id, member_id, kind, origin_type, origin_id, clinic_id, opened_at)
SELECT e.family_id, e.member_id, 'ROUTINE', 'EXAMINATION', e.id, e.clinic_id, e.created_at
FROM examinations e
WHERE e.process_id IS NULL
ON CONFLICT (origin_type, origin_id) DO NOTHING;

UPDATE examinations e
SET process_id = p.id
FROM processes p
WHERE p.origin_type = 'EXAMINATION' AND p.origin_id = e.id AND e.process_id IS NULL;
