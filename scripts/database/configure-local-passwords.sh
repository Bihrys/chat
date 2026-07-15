#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"
SOCKET_DIR="$ROOT/var/run/sockets/postgresql"

export IDENTITY_DB_PASSWORD AUTH_DB_PASSWORD KEY_DIRECTORY_DB_PASSWORD \
    KEY_TRANSPARENCY_DB_PASSWORD MAILBOX_DB_PASSWORD OBJECT_DB_PASSWORD \
    GROUP_DB_PASSWORD BACKUP_DB_PASSWORD CONFIG_DB_PASSWORD DIAGNOSTIC_DB_PASSWORD

psql -h "$SOCKET_DIR" -p "$POSTGRES_PORT" -U "$POSTGRES_ADMIN_USER" -d postgres <<'SQL'
\getenv identity_password IDENTITY_DB_PASSWORD
\getenv auth_password AUTH_DB_PASSWORD
\getenv key_directory_password KEY_DIRECTORY_DB_PASSWORD
\getenv key_transparency_password KEY_TRANSPARENCY_DB_PASSWORD
\getenv mailbox_password MAILBOX_DB_PASSWORD
\getenv object_password OBJECT_DB_PASSWORD
\getenv group_password GROUP_DB_PASSWORD
\getenv backup_password BACKUP_DB_PASSWORD
\getenv config_password CONFIG_DB_PASSWORD
\getenv diagnostic_password DIAGNOSTIC_DB_PASSWORD
ALTER ROLE chat_identity PASSWORD :'identity_password';
ALTER ROLE chat_auth PASSWORD :'auth_password';
ALTER ROLE chat_key_directory PASSWORD :'key_directory_password';
ALTER ROLE chat_key_transparency PASSWORD :'key_transparency_password';
ALTER ROLE chat_mailbox PASSWORD :'mailbox_password';
ALTER ROLE chat_object PASSWORD :'object_password';
ALTER ROLE chat_group PASSWORD :'group_password';
ALTER ROLE chat_backup PASSWORD :'backup_password';
ALTER ROLE chat_config PASSWORD :'config_password';
ALTER ROLE chat_diagnostic PASSWORD :'diagnostic_password';
SQL

echo "Local PostgreSQL service-role passwords configured from .env."
