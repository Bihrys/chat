#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/common.sh"
load_chat_env "$ROOT"

for var in \
    IDENTITY_DATABASE_URL AUTH_DATABASE_URL KEY_DIRECTORY_DATABASE_URL \
    KEY_TRANSPARENCY_DATABASE_URL MAILBOX_DATABASE_URL OBJECT_DATABASE_URL \
    GROUP_DATABASE_URL BACKUP_DATABASE_URL CONFIG_DATABASE_URL DIAGNOSTIC_DATABASE_URL
do
    url="${!var}"
    psql "$url" -Atc 'SELECT current_user, current_database();' >/dev/null
    echo "[OK] $var"
done
