-- name: Ping :one
-- Verificação de ligação (readiness). Queries de negócio vivem em db/queries/<modulo>.sql.
SELECT 1::int AS ok;
