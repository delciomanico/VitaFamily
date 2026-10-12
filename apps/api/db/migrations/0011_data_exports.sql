-- Exportação de dados (M9, UC-ACC-06/FR-PRIV-05, schema.md §5 `data_exports`). Pacote .zip (JSON +
-- documentos) gerado pelo módulo `lifecycle`, guardado no bucket de exportações e válido 7 dias.
-- `subject_member_id`/`family_id`: preenchidos só na exportação de um dependente pelo tutor (P2).
-- SQL simples, sem marcadores +goose (ADR-014/ADR-015).
CREATE TABLE data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id uuid,
  subject_member_id uuid,
  reason export_reason NOT NULL,
  status export_status NOT NULL DEFAULT 'PENDING',
  storage_key text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Limite de pedidos por dia (N7) e listagem do utilizador.
CREATE INDEX data_exports_requested_by_idx ON data_exports (requested_by, created_at DESC);
