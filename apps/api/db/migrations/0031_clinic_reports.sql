-- M15 S/T (ADR-027, BR-CLN-41..50, schema.md §3g): relatório da consulta (1:1 com a marcação da clínica, DRAFT -> FINAL
-- imutável por trigger) com adendas, rascunho de resultados de exame e `documents.generated_by_system` (laudo PDF gerado
-- pelo servidor). Única migração, transacional e retrocompatível (padrão expand): nenhuma linha existente muda de
-- significado; sem `ADD VALUE` nem backfill.
-- Registo da clínica (BR-CLN-50): `booking_id` é um uuid simples (sem FK para `appointments`/`clinic_visits`) para o
-- relatório sobreviver ao apagamento Vita; só apaga com a clínica (cascata).

CREATE TYPE consultation_booking_kind AS ENUM ('APPOINTMENT', 'VISIT');
CREATE TYPE consultation_report_status AS ENUM ('DRAFT', 'FINAL');

CREATE TABLE clinic_consultation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  booking_kind consultation_booking_kind NOT NULL,
  booking_id uuid NOT NULL,
  clinic_patient_id uuid,
  status consultation_report_status NOT NULL DEFAULT 'DRAFT',
  reason text,
  findings text,
  impression text,
  plan text,
  shared_with_patient boolean NOT NULL DEFAULT true,
  patient_name text NOT NULL,
  patient_birth_date date,
  consultation_at timestamptz NOT NULL,
  specialty text,
  author_name text NOT NULL,
  issuer jsonb,
  author_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_consultation_reports_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT clinic_consultation_reports_booking_key UNIQUE (clinic_id, booking_kind, booking_id),
  CONSTRAINT clinic_consultation_reports_patient_fk FOREIGN KEY (clinic_id, clinic_patient_id) REFERENCES clinic_patients (clinic_id, id),
  CONSTRAINT clinic_consultation_reports_reason_check CHECK (reason IS NULL OR char_length(reason) <= 300),
  CONSTRAINT clinic_consultation_reports_findings_check CHECK (findings IS NULL OR char_length(findings) <= 1500),
  CONSTRAINT clinic_consultation_reports_impression_check CHECK (impression IS NULL OR char_length(impression) <= 500),
  CONSTRAINT clinic_consultation_reports_plan_check CHECK (plan IS NULL OR char_length(plan) <= 1500),
  CONSTRAINT clinic_consultation_reports_sections_check CHECK (num_nonnulls(reason, findings, impression, plan) >= 1),
  CONSTRAINT clinic_consultation_reports_patient_name_check CHECK (char_length(patient_name) BETWEEN 1 AND 120),
  CONSTRAINT clinic_consultation_reports_author_name_check CHECK (char_length(author_name) BETWEEN 1 AND 120),
  CONSTRAINT clinic_consultation_reports_specialty_check CHECK (specialty IS NULL OR char_length(specialty) <= 80),
  CONSTRAINT clinic_consultation_reports_final_check CHECK ((status = 'FINAL') = (finalized_at IS NOT NULL AND issuer IS NOT NULL)),
  CONSTRAINT clinic_consultation_reports_visit_not_shared_check CHECK (booking_kind = 'APPOINTMENT' OR NOT shared_with_patient)
);
CREATE INDEX clinic_consultation_reports_patient_idx ON clinic_consultation_reports (clinic_id, clinic_patient_id) WHERE clinic_patient_id IS NOT NULL;

CREATE TABLE clinic_consultation_report_addenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  report_id uuid NOT NULL,
  text text NOT NULL,
  author_name text NOT NULL,
  author_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_consultation_report_addenda_report_fk FOREIGN KEY (clinic_id, report_id) REFERENCES clinic_consultation_reports (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT clinic_consultation_report_addenda_text_check CHECK (char_length(text) BETWEEN 1 AND 1500),
  CONSTRAINT clinic_consultation_report_addenda_author_name_check CHECK (char_length(author_name) BETWEEN 1 AND 120)
);
CREATE INDEX clinic_consultation_report_addenda_report_idx ON clinic_consultation_report_addenda (clinic_id, report_id, created_at);

-- Rascunho de resultados de exame (BR-CLN-47): um por exame; cascata com o exame (D15); contém dados de saúde.
CREATE TABLE clinic_exam_result_drafts (
  examination_id uuid PRIMARY KEY REFERENCES examinations (id) ON DELETE CASCADE,
  results jsonb NOT NULL DEFAULT '[]',
  result_note text,
  updated_by_clinic_account_id uuid REFERENCES clinic_accounts (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_exam_result_drafts_results_check CHECK (jsonb_typeof(results) = 'array' AND jsonb_array_length(results) <= 50),
  CONSTRAINT clinic_exam_result_drafts_note_check CHECK (result_note IS NULL OR char_length(result_note) <= 2000),
  CONSTRAINT clinic_exam_result_drafts_content_check CHECK (jsonb_array_length(results) > 0 OR result_note IS NOT NULL)
);

-- Imutabilidade do FINAL (BR-CLN-43): a única alteração tolerada é `author_account_id -> NULL` (ON DELETE SET NULL da conta).
CREATE FUNCTION clinic_consultation_reports_final_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'FINAL' AND (to_jsonb(NEW) - 'author_account_id') IS DISTINCT FROM (to_jsonb(OLD) - 'author_account_id') THEN
    RAISE EXCEPTION 'relatório FINAL é imutável' USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_consultation_reports_final_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER clinic_consultation_reports_final_immutable BEFORE UPDATE ON clinic_consultation_reports
  FOR EACH ROW EXECUTE FUNCTION clinic_consultation_reports_final_immutable();

CREATE FUNCTION clinic_consultation_report_addenda_immutable() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'author_account_id') IS DISTINCT FROM (to_jsonb(OLD) - 'author_account_id') THEN
    RAISE EXCEPTION 'adenda é imutável' USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_consultation_report_addenda_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER clinic_consultation_report_addenda_immutable BEFORE UPDATE ON clinic_consultation_report_addenda
  FOR EACH ROW EXECUTE FUNCTION clinic_consultation_report_addenda_immutable();

-- Laudo PDF gerado pelo servidor (BR-CLN-49): nasce CLEAN (sem quarentena/ClamAV), da clínica, sempre de um exame.
ALTER TABLE documents ADD COLUMN generated_by_system boolean NOT NULL DEFAULT false;
ALTER TABLE documents
  ADD CONSTRAINT documents_generated_by_system_check CHECK (NOT generated_by_system OR (uploaded_by_clinic AND examination_id IS NOT NULL AND uploaded_by IS NULL AND scan_status = 'CLEAN'));
CREATE UNIQUE INDEX documents_generated_exam_uq ON documents (examination_id) WHERE generated_by_system;
