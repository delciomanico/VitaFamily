#!/usr/bin/env bash
# Backup diário do PostgreSQL de produção (deployment.md §5: retenção 30 dias, encriptado, UE).
# Uso na VPS (cron, fora dos contentores): deploy/scripts/backup-postgres.sh
# Variáveis (deploy/.env, mesmo ficheiro do docker-compose.api.prod.yml):
#   POSTGRES_USER, POSTGRES_DB            — já existem em deploy/.env
#   BACKUP_DIR                            — default /var/backups/vitafamily/postgres
#   BACKUP_RETENTION_DAYS                 — default 30 (deployment.md §5)
#   BACKUP_ENCRYPTION_PASSPHRASE          — se definida, encripta o dump (openssl aes-256-cbc);
#                                           sem ela o script falha (nunca guardar dados de saúde
#                                           em claro em disco — security.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.api.prod.yml"
ENV_FILE="$DEPLOY_DIR/.env"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${POSTGRES_USER:?defina POSTGRES_USER em deploy/.env}"
: "${POSTGRES_DB:?defina POSTGRES_DB em deploy/.env}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?defina BACKUP_ENCRYPTION_PASSPHRASE (segredo de backup, distinto dos de deploy/.env)}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/vitafamily/postgres}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$BACKUP_DIR/vitafamily-postgres-$TIMESTAMP.dump.enc"

mkdir -p "$BACKUP_DIR"

echo "[backup-postgres] a fazer dump de $POSTGRES_DB (projeto vitafamily-api) para $DUMP_FILE"
docker compose -p vitafamily-api -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  | openssl enc -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -out "$DUMP_FILE"

SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "[backup-postgres] ok: $DUMP_FILE ($SIZE)"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/last-success.txt"

echo "[backup-postgres] a limpar backups com mais de $RETENTION_DAYS dias em $BACKUP_DIR"
find "$BACKUP_DIR" -name 'vitafamily-postgres-*.dump.enc' -mtime "+$RETENTION_DAYS" -print -delete
