-- Recomendações da clínica (D19/ADR-023, BR-CLN-09; schema.md §3 "recommendations", §7 enums).
-- Os valores novos de `alert_type`/`alert_source` não são usados nesta migração (limite do
-- PostgreSQL com `ADD VALUE` na mesma transação); só ficam disponíveis para as migrações/pedidos
-- seguintes. SQL simples, sem marcadores +goose (ADR-014/ADR-015). Não edita migrações anteriores.
ALTER TYPE alert_type ADD VALUE 'RECOMMENDATION_ADDED';
ALTER TYPE alert_source ADD VALUE 'RECOMMENDATION';

CREATE TABLE recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  -- Rastreabilidade (espelho de BR-RX-07 / BR-CLN-08): `clinic_id` e `clinic_account_id` ficam nulos
  -- se a clínica/conta for removida; NENHUMA CHECK exige a conta autora não-nula (SET NULL válido).
  clinic_id uuid REFERENCES clinics (id) ON DELETE SET NULL,
  clinic_name text NOT NULL,
  clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES appointments (id) ON DELETE CASCADE,
  examination_id uuid REFERENCES examinations (id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Isolamento por família e cascata com o membro (D15, ADR-008).
  CONSTRAINT recommendations_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  -- BR-CLN-09: exatamente uma origem; texto 1-2000 caracteres.
  CONSTRAINT recommendations_single_origin_check CHECK (num_nonnulls(appointment_id, examination_id) = 1),
  CONSTRAINT recommendations_text_length_check CHECK (char_length(text) BETWEEN 1 AND 2000)
);
-- indexes.md: leitura pelo paciente, filtros por origem e listagem da clínica.
CREATE INDEX recommendations_member_created_idx ON recommendations (member_id, created_at DESC);
CREATE INDEX recommendations_appointment_idx ON recommendations (appointment_id);
CREATE INDEX recommendations_examination_idx ON recommendations (examination_id);
CREATE INDEX recommendations_clinic_created_idx ON recommendations (clinic_id, created_at DESC);
