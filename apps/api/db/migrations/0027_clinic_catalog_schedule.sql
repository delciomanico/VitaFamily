-- M14 a1/a2 (ADR-026, BR-CLN-11..16, schema.md §3a): catálogo da clínica (profissionais e tipos de
-- serviço), regras de horário semanais, bloqueios/férias, ligação dos `clinic_slots` ao catálogo com
-- exclusão de sobreposição por profissional (EXCLUDE gist) e duração nas consultas. Padrão expand:
-- tudo retrocompatível (colunas nulas/com default; os horários existentes ficam fora da exclusão).

-- 1. btree_gist: `uuid WITH =` dentro de um índice GiST (extensão trusted desde PG 13).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Moeda da clínica (só leitura nas fases a1/a2; a edição é da fase e).
ALTER TABLE clinics
  ADD COLUMN currency text NOT NULL DEFAULT 'AOA',
  ADD CONSTRAINT clinics_currency_check CHECK (currency ~ '^[A-Z]{3}$');

-- 3. Catálogo, regras e bloqueios. UNIQUE (clinic_id, id) é o alvo das FKs compostas: um
-- profissional/serviço/regra só se liga a horários da MESMA clínica. NO ACTION: nunca se apagam; a
-- cascata da clínica remove tudo na mesma instrução (as FKs NO ACTION verificam no fim da instrução).
CREATE TABLE clinic_professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  name text NOT NULL,
  specialty text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_professionals_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT clinic_professionals_name_length_check CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT clinic_professionals_specialty_length_check CHECK (specialty IS NULL OR char_length(specialty) <= 80)
);
CREATE UNIQUE INDEX clinic_professionals_active_name_uq ON clinic_professionals (clinic_id, lower(name)) WHERE active;
CREATE INDEX clinic_professionals_clinic_active_idx ON clinic_professionals (clinic_id, active);

CREATE TABLE clinic_service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  name text NOT NULL,
  kind clinic_slot_kind NOT NULL,
  duration_minutes int NOT NULL,
  price_minor bigint,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_service_types_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT clinic_service_types_name_length_check CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT clinic_service_types_duration_check CHECK (duration_minutes IN (15, 20, 30, 45, 60)),
  CONSTRAINT clinic_service_types_price_check CHECK (price_minor IS NULL OR price_minor BETWEEN 0 AND 100000000000)
);
CREATE UNIQUE INDEX clinic_service_types_active_name_uq ON clinic_service_types (clinic_id, kind, lower(name)) WHERE active;
CREATE INDEX clinic_service_types_clinic_active_idx ON clinic_service_types (clinic_id, active);

CREATE TABLE clinic_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  professional_id uuid NOT NULL,
  service_type_id uuid NOT NULL,
  weekdays smallint[] NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  valid_from date,
  valid_until date,
  capacity int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_schedule_rules_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT clinic_schedule_rules_professional_fk FOREIGN KEY (clinic_id, professional_id)
    REFERENCES clinic_professionals (clinic_id, id) ON DELETE NO ACTION,
  CONSTRAINT clinic_schedule_rules_service_type_fk FOREIGN KEY (clinic_id, service_type_id)
    REFERENCES clinic_service_types (clinic_id, id) ON DELETE NO ACTION,
  CONSTRAINT clinic_schedule_rules_weekdays_check
    CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  CONSTRAINT clinic_schedule_rules_time_order_check CHECK (end_time > start_time),
  CONSTRAINT clinic_schedule_rules_validity_check CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CONSTRAINT clinic_schedule_rules_capacity_check CHECK (capacity BETWEEN 1 AND 50)
);
CREATE INDEX clinic_schedule_rules_clinic_active_idx ON clinic_schedule_rules (clinic_id, active);
CREATE INDEX clinic_schedule_rules_professional_active_idx ON clinic_schedule_rules (professional_id) WHERE active;

CREATE TABLE clinic_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  professional_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_time_off_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT clinic_time_off_professional_fk FOREIGN KEY (clinic_id, professional_id)
    REFERENCES clinic_professionals (clinic_id, id) ON DELETE NO ACTION,
  CONSTRAINT clinic_time_off_range_check CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '366 days'),
  CONSTRAINT clinic_time_off_reason_length_check CHECK (reason IS NULL OR char_length(reason) <= 200)
);
CREATE INDEX clinic_time_off_professional_ends_idx ON clinic_time_off (professional_id, ends_at);

-- 4. `clinic_slots`: ligação ao catálogo e `ends_at` (mantida pelo serviço; `timestamptz + interval` não é
-- IMMUTABLE, logo não pode ser coluna gerada nem entrar na exclusão). Os horários existentes têm
-- `professional_id` nulo e ficam fora da exclusão.
ALTER TABLE clinic_slots
  ADD COLUMN professional_id uuid,
  ADD COLUMN service_type_id uuid,
  ADD COLUMN schedule_rule_id uuid,
  ADD COLUMN ends_at timestamptz;
UPDATE clinic_slots SET ends_at = starts_at + duration_minutes * interval '1 minute';
ALTER TABLE clinic_slots ALTER COLUMN ends_at SET NOT NULL;

ALTER TABLE clinic_slots
  ADD CONSTRAINT clinic_slots_professional_fk FOREIGN KEY (clinic_id, professional_id)
    REFERENCES clinic_professionals (clinic_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT clinic_slots_service_type_fk FOREIGN KEY (clinic_id, service_type_id)
    REFERENCES clinic_service_types (clinic_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT clinic_slots_schedule_rule_fk FOREIGN KEY (clinic_id, schedule_rule_id)
    REFERENCES clinic_schedule_rules (clinic_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT clinic_slots_ends_at_check CHECK (ends_at = starts_at + duration_minutes * interval '1 minute'),
  ADD CONSTRAINT clinic_slots_rule_requires_catalog_check
    CHECK (schedule_rule_id IS NULL OR (professional_id IS NOT NULL AND service_type_id IS NOT NULL));

-- Idempotência da geração (BR-CLN-12).
CREATE UNIQUE INDEX clinic_slots_rule_starts_at_uq ON clinic_slots (schedule_rule_id, starts_at) WHERE schedule_rule_id IS NOT NULL;
-- Calendário por profissional / deteção de sobreposição / bloqueios.
CREATE INDEX clinic_slots_professional_starts_at_idx ON clinic_slots (professional_id, starts_at) WHERE professional_id IS NOT NULL;
-- Sobreposição de intervalos semiabertos do mesmo profissional (BR-CLN-13).
ALTER TABLE clinic_slots
  ADD CONSTRAINT clinic_slots_professional_no_overlap
  EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (professional_id IS NOT NULL);

-- 5. Duração nas marcações (BR-CLN-16): 30 por omissão; as ligadas a horário assumem a do horário.
ALTER TABLE appointments
  ADD COLUMN duration_minutes int NOT NULL DEFAULT 30,
  ADD CONSTRAINT appointments_duration_minutes_check CHECK (duration_minutes BETWEEN 5 AND 480);
UPDATE appointments a SET duration_minutes = s.duration_minutes FROM clinic_slots s WHERE a.slot_id = s.id;
