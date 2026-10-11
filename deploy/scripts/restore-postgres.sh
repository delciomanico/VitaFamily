#!/usr/bin/env bash
# Restauro de um backup criado por backup-postgres.sh — usar no ensaio trimestral/pré-release
# (deployment.md §5, RTO <= 8h) ou numa recuperação real. NÃO corre automaticamente.
# Uso: deploy/scripts/restore-postgres.sh /var/backups/vitafamily/postgres/vitafamily-postgres-<ts>.dump.enc
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.api.prod.yml"
ENV_FILE="$DEPLOY_DIR/.env"
ENC_FILE="${1:?uso: restore-postgres.sh <ficheiro.dump.enc>}"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${POSTGRES_USER:?defina POSTGRES_USER em deploy/.env}"
: "${POSTGRES_DB:?defina POSTGRES_DB em deploy/.env}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?defina BACKUP_ENCRYPTION_PASSPHRASE (a mesma do backup a restaurar)}"

echo "[restore-postgres] AVISO: isto substitui o conteúdo atual de '$POSTGRES_DB'. Ctrl+C para cancelar."
sleep 5

TMP_DUMP="$(mktemp)"
trap 'rm -f "$TMP_DUMP"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$ENC_FILE" -out "$TMP_DUMP"

echo "[restore-postgres] a restaurar $ENC_FILE para $POSTGRES_DB"
docker compose -p vitafamily-api -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
  exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < "$TMP_DUMP"

echo "[restore-postgres] ok"
