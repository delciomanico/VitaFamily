-- Apólices e pedidos de reembolso (ADR-021/ADR-023, schema.md §3 `insurance_policies`,
-- `reimbursement_claims`, `reimbursement_claim_documents` e `documents.insurance_policy_id`). Fase 4b.
-- Depende de 0024 (insurer_accounts, insurance_accounts).

CREATE TYPE reimbursement_claim_status AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');

-- Categoria sem partilha (BR-INS-02): só SELF/TUTOR_OF, verificado em `AccessPolicy`.
CREATE TABLE insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  insurer_id uuid REFERENCES insurer_accounts (id) ON DELETE SET NULL,
  insurer_name text NOT NULL,
  policy_number text NOT NULL,
  holder_name text NOT NULL,
  valid_until date,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurance_policies_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  -- Alvo da FK composta de `documents` (foto do cartão): o documento tem de ser do mesmo membro.
  CONSTRAINT insurance_policies_family_member_id_uq UNIQUE (family_id, member_id, id)
);
CREATE INDEX insurance_policies_member_idx ON insurance_policies (family_id, member_id, created_at DESC);
CREATE INDEX insurance_policies_insurer_idx ON insurance_policies (insurer_id) WHERE insurer_id IS NOT NULL;

CREATE TABLE reimbursement_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES insurance_policies (id) ON DELETE CASCADE,
  -- Desnormalizado de `insurance_policies.insurer_id` para o isolamento do portal (BR-INS-03); garantido no serviço.
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE RESTRICT,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  status reimbursement_claim_status NOT NULL DEFAULT 'SUBMITTED',
  decision_note text,
  decided_by_insurance_account_id uuid REFERENCES insurance_accounts (id) ON DELETE SET NULL,
  decided_at timestamptz,
  submitted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reimbursement_claims_amount_positive CHECK (amount > 0),
  -- BR-INS-05 (corrige a v0.3 do schema.md): o motivo só é obrigatório quando REJECTED, não em SUBMITTED.
  CONSTRAINT reimbursement_claims_rejected_needs_note CHECK (status <> 'REJECTED' OR decision_note IS NOT NULL)
);
CREATE INDEX reimbursement_claims_policy_idx ON reimbursement_claims (policy_id, created_at DESC);
CREATE INDEX reimbursement_claims_insurer_idx ON reimbursement_claims (insurer_id, status, created_at DESC);

-- A única superfície de documentos que a seguradora vê (BR-INS-04): nunca se junta `documents` por `member_id` no portal.
CREATE TABLE reimbursement_claim_documents (
  claim_id uuid NOT NULL REFERENCES reimbursement_claims (id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  PRIMARY KEY (claim_id, document_id)
);
CREATE INDEX reimbursement_claim_documents_document_idx ON reimbursement_claim_documents (document_id);

-- Foto do cartão (ADR-021): 3.º tipo de recurso de `documents`. FK composta (mesma família/membro da apólice) com CASCADE.
ALTER TABLE documents ADD COLUMN insurance_policy_id uuid;
ALTER TABLE documents
  ADD CONSTRAINT documents_insurance_policy_fk FOREIGN KEY (family_id, member_id, insurance_policy_id)
    REFERENCES insurance_policies (family_id, member_id, id) ON DELETE CASCADE;
ALTER TABLE documents DROP CONSTRAINT documents_exactly_one_resource;
ALTER TABLE documents
  ADD CONSTRAINT documents_exactly_one_resource CHECK (num_nonnulls(prescription_id, examination_id, insurance_policy_id) = 1);
CREATE INDEX documents_insurance_policy_idx ON documents (insurance_policy_id) WHERE insurance_policy_id IS NOT NULL;
