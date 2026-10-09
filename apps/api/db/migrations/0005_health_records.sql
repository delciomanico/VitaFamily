-- Registos de saúde simples (schema.md §3, M4/FR-HP): allergies, medical_conditions. FK composta
-- (family_id, member_id) -> family_members(family_id, id) garante isolamento entre famílias
-- (ADR-008, AC-ISO-01) — nunca um FK simples por id. `condition_kind` já criado em
-- 0001_extensions_and_enums.sql. SQL simples, sem marcadores +goose (ADR-014/ADR-015).
-- Nota: tipo sanguíneo (FR-HP-01) não tem tabela própria — é a coluna `blood_type` de
-- `family_members` (0003_families.sql), gerida pela API pública de `families` (modules.md §3
-- nota 9); `health-records` só decide a autorização (categoria ALLERGIES) e regista a auditoria.

CREATE TABLE allergies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  name text NOT NULL,
  notes text,
  since date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allergies_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- Listagens por membro (indexes.md §"allergies, medical_conditions").
CREATE INDEX allergies_member_id_idx ON allergies (member_id);

CREATE TABLE medical_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  name text NOT NULL,
  kind condition_kind NOT NULL,
  notes text,
  since date,
  until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- schema.md §3: `until >= since`; NULL em qualquer dos lados não viola o CHECK (lógica a três
  -- valores do SQL), por isso não precisa de guarda explícita para os campos opcionais.
  CONSTRAINT medical_conditions_until_after_since CHECK (until >= since),
  CONSTRAINT medical_conditions_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
CREATE INDEX medical_conditions_member_id_idx ON medical_conditions (member_id);
