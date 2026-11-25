-- M18 (ADR-039, schema.md §15): consentimentos do assistente de IA ligado pelo utilizador (módulo `ai-assistant`). Uma só tabela; só metadados
-- (utilizador, membro, fornecedor, versão do texto, datas). Nunca chaves, tokens, sintomas, contexto enviado nem respostas. Separada de
-- `sharing_grants`. Um novo consentimento depois de revogado cria nova linha (o histórico serve de prova). Sem seeds nem backfill; SQL simples.
CREATE TYPE ai_provider AS ENUM ('GEMINI', 'CLAUDE', 'OPENAI');

CREATE TABLE ai_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  provider ai_provider NOT NULL,
  consent_version text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_consents_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  CONSTRAINT ai_consents_version_check CHECK (char_length(consent_version) BETWEEN 1 AND 20),
  CONSTRAINT ai_consents_revoked_check CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- Um consentimento ativo por utilizador, membro e fornecedor.
CREATE UNIQUE INDEX ai_consents_active_uq ON ai_consents (user_id, member_id, provider) WHERE revoked_at IS NULL;
CREATE INDEX ai_consents_member_idx ON ai_consents (family_id, member_id);
-- Expurgo (job diário): consentimentos revogados há mais de 24 meses.
CREATE INDEX ai_consents_revoked_idx ON ai_consents (revoked_at) WHERE revoked_at IS NOT NULL;
