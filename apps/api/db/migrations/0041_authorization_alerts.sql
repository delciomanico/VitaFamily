-- Alertas do pedido de autorização à família (marco B fatia 5, ADR-036; schema.md §5, migrations.md "0041", BR-ALR-10..12).
-- Só aditiva: sem tabelas nem colunas novas, sem backfill (alertas históricos não se geram), sem CHECK/trigger.
-- `ADD VALUE` numa transação (PostgreSQL >= 12) é permitido desde que o valor novo não seja usado nesta migração
-- (mesmo padrão de 0023/0029/0032/0039/0040): o índice abaixo só referencia 'APPROVED' de `authorization_status`.
ALTER TYPE alert_type ADD VALUE 'AUTHORIZATION_APPROVED';
ALTER TYPE alert_type ADD VALUE 'AUTHORIZATION_NOT_APPROVED';
ALTER TYPE alert_type ADD VALUE 'AUTHORIZATION_INFO_REQUESTED';
ALTER TYPE alert_type ADD VALUE 'AUTHORIZATION_EXPIRING';
ALTER TYPE alert_type ADD VALUE 'AUTHORIZATION_WITHDRAWN';
ALTER TYPE alert_source ADD VALUE 'PROCESS';

-- Candidatas de `AUTHORIZATION_EXPIRING` no scanner `alerts.scan` (BR-ALR-10).
CREATE INDEX insurer_authorizations_expiring_idx ON insurer_authorizations (valid_until) WHERE status = 'APPROVED' AND process_id IS NOT NULL;
