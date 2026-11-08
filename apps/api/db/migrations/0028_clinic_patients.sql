-- M14 P (ADR-026, BR-CLN-17..24, schema.md §3d): pacientes da clínica (registo próprio da clínica, sem ids
-- Vita), ligação servidor paciente↔membro Vita, consentimento por clínica, códigos de ligação e visitas
-- presenciais manuais. Padrão expand: só tabelas/enums novos (nenhuma tabela existente é alterada).
-- Cascatas (BR-CLN-24): apagar o membro/conta/família apaga links, consentimentos e códigos, mas NUNCA
-- `clinic_patients`/`clinic_visits` (sem FK para users/families/family_members).

CREATE TYPE clinic_patient_origin AS ENUM ('MANUAL', 'VITA');
CREATE TYPE clinic_link_via AS ENUM ('EMAIL', 'CODE');
CREATE TYPE clinic_consent_level AS ENUM ('BOOKINGS', 'HISTORY');
CREATE TYPE clinic_visit_status AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- Registo da clínica: `name_norm` (minúsculas sem acentos) e `phone_digits` são mantidos pelo serviço e servem
-- só a pesquisa. `UNIQUE (clinic_id, id)` é o alvo das FKs compostas (um link/visita só liga pacientes da MESMA clínica).
CREATE TABLE clinic_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  name text NOT NULL,
  name_norm text NOT NULL,
  phone text,
  phone_digits text,
  email text,
  birth_date date,
  notes text,
  origin clinic_patient_origin NOT NULL,
  created_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_patients_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT clinic_patients_name_length_check CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT clinic_patients_phone_length_check CHECK (phone IS NULL OR char_length(phone) <= 30),
  CONSTRAINT clinic_patients_email_length_check CHECK (email IS NULL OR char_length(email) <= 254),
  CONSTRAINT clinic_patients_notes_length_check CHECK (notes IS NULL OR char_length(notes) <= 2000)
);
CREATE INDEX clinic_patients_name_idx ON clinic_patients (clinic_id, name_norm, id);
CREATE INDEX clinic_patients_phone_idx ON clinic_patients (clinic_id, phone_digits) WHERE phone_digits IS NOT NULL;
CREATE INDEX clinic_patients_email_idx ON clinic_patients (clinic_id, email) WHERE email IS NOT NULL;

-- Única ponte para ids Vita (nunca exposta pela API do portal). Coerência família↔membro validada no serviço.
CREATE TABLE clinic_patient_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  clinic_patient_id uuid NOT NULL,
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
  via clinic_link_via NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_patient_links_patient_fk FOREIGN KEY (clinic_id, clinic_patient_id) REFERENCES clinic_patients (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT clinic_patient_links_patient_key UNIQUE (clinic_patient_id),
  CONSTRAINT clinic_patient_links_clinic_member_key UNIQUE (clinic_id, member_id)
);
CREATE INDEX clinic_patient_links_member_idx ON clinic_patient_links (member_id);

CREATE TABLE clinic_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
  level clinic_consent_level NOT NULL,
  history_valid_until timestamptz,
  granted_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_consents_clinic_member_key UNIQUE (clinic_id, member_id),
  CONSTRAINT clinic_consents_history_valid_until_check CHECK ((level = 'HISTORY') = (history_valid_until IS NOT NULL))
);
CREATE INDEX clinic_consents_member_idx ON clinic_consents (member_id);

-- Só o HMAC-SHA256 do código normalizado (nunca o código). Sem `clinic_id`: o código não é de uma clínica.
CREATE TABLE clinic_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_link_codes_code_hash_key UNIQUE (code_hash)
);
CREATE INDEX clinic_link_codes_active_member_idx ON clinic_link_codes (member_id) WHERE used_at IS NULL;
CREATE INDEX clinic_link_codes_expires_at_idx ON clinic_link_codes (expires_at);

-- Visita presencial só da clínica (paciente sem ligação Vita). FK composta NO ACTION: nunca se apaga o paciente
-- (sem DELETE nesta fase); a cascata da clínica remove as duas tabelas na mesma instrução.
CREATE TABLE clinic_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  clinic_patient_id uuid NOT NULL,
  slot_id uuid REFERENCES clinic_slots (id) ON DELETE SET NULL,
  scheduled_at timestamptz NOT NULL,
  duration_minutes int NOT NULL,
  status clinic_visit_status NOT NULL DEFAULT 'SCHEDULED',
  notes text,
  outcome_note text,
  cancel_note text,
  booked_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_visits_patient_fk FOREIGN KEY (clinic_id, clinic_patient_id) REFERENCES clinic_patients (clinic_id, id),
  CONSTRAINT clinic_visits_duration_check CHECK (duration_minutes BETWEEN 5 AND 480),
  CONSTRAINT clinic_visits_notes_length_check CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT clinic_visits_outcome_note_length_check CHECK (outcome_note IS NULL OR char_length(outcome_note) <= 2000),
  CONSTRAINT clinic_visits_cancel_note_length_check CHECK (cancel_note IS NULL OR char_length(cancel_note) <= 2000)
);
CREATE INDEX clinic_visits_clinic_scheduled_idx ON clinic_visits (clinic_id, scheduled_at);
CREATE INDEX clinic_visits_patient_scheduled_idx ON clinic_visits (clinic_patient_id, scheduled_at DESC);
CREATE UNIQUE INDEX clinic_visits_slot_active_idx ON clinic_visits (slot_id) WHERE status = 'SCHEDULED' AND slot_id IS NOT NULL;
