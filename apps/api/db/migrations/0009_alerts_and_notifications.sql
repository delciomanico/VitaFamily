-- Alertas e notificações (schema.md §1/§4, M8/FR-ALR): push_subscriptions, alerts, notifications.
-- `notification_preferences` já existe (0002_identity.sql, criada em antecipação a este módulo —
-- ver NOTA de change control em `modules/users/infrastructure/schema.ts`); não recriar aqui.
-- Enums já criados em 0001_extensions_and_enums.sql. SQL simples, sem marcadores +goose
-- (ADR-014/ADR-015).

-- push_subscriptions (UC-ALR-06): endpoint único; repetido atualiza a existente (upsert na aplicação).
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);

-- alerts (ADR-009, BR-ALR-02): dedupe_key único garante idempotência do scanner. FK composta
-- (family_id, member_id) -> family_members(family_id, id) garante isolamento (ADR-008).
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  type alert_type NOT NULL,
  source_type alert_source NOT NULL,
  source_id uuid NOT NULL,
  rule_key text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  trigger_at timestamptz NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alerts_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- Lista de alertas por utilizador, não lidos primeiro (indexes.md).
CREATE INDEX alerts_recipient_idx ON alerts (recipient_user_id, read_at, trigger_at DESC);
-- Cancelar/recalcular alertas ao editar recurso (indexes.md) — consulta por origem.
CREATE INDEX alerts_source_idx ON alerts (source_type, source_id);

-- notifications (ST6): uma linha por canal ativo; UNIQUE (alert_id, channel) evita duplicar.
-- `recipient_user_id` desnormalizado de `alerts.recipient_user_id` (06-architecture/modules.md §3
-- nota 15): `notifications` nunca lê a tabela `alerts` (evita um ciclo com `alerts -> notifications`,
-- já declarado nessa direção) — por isso precisa do destinatário na própria linha para decidir
-- SKIPPED por conta suspensa/canal desativado no envio (`notifications.send`).
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel channel NOT NULL,
  status notification_status NOT NULL DEFAULT 'PENDING',
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, channel)
);
-- Fila de envio/retry (indexes.md): PENDING (1.ª tentativa) ou FAILED com next_attempt_at <= now.
CREATE INDEX notifications_retry_idx ON notifications (status, next_attempt_at) WHERE status IN ('PENDING', 'FAILED');
