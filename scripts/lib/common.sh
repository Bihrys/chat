#!/usr/bin/env bash
set -Eeuo pipefail

chat_root() {
    cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

load_chat_env() {
    local root="${1:-$(chat_root)}"
    local example="$root/.env.example"
    local env_file="$root/.env"

    # Load repository defaults when present. Older checkouts may have an
    # incomplete .env.example, so hard defaults are applied below as the
    # final compatibility layer.
    set -a
    if [[ -f "$example" ]]; then
        # shellcheck disable=SC1090
        source "$example"
    fi

    if [[ ! -f "$env_file" ]]; then
        if [[ -f "$example" ]]; then
            cp "$example" "$env_file"
        else
            : > "$env_file"
        fi
        chmod 600 "$env_file"
        echo "[INFO] Created $env_file"
    fi

    # Local values override repository defaults.
    # shellcheck disable=SC1090
    source "$env_file"

    # Hard compatibility defaults. These deliberately use := so both an
    # unset variable and an empty value are repaired before `set -u` can
    # terminate infrastructure scripts.
    : "${CHAT_ENV:=local}"
    : "${CHAT_LOG_LEVEL:=debug}"

    : "${POSTGRES_HOST:=127.0.0.1}"
    : "${POSTGRES_PORT:=55432}"
    : "${POSTGRES_ADMIN_USER:=chat_admin}"

    : "${VALKEY_HOST:=127.0.0.1}"
    : "${VALKEY_PORT:=56379}"
    : "${VALKEY_URL:=redis://${VALKEY_HOST}:${VALKEY_PORT}}"

    : "${MINIO_HOST:=127.0.0.1}"
    : "${MINIO_API_PORT:=59000}"
    : "${MINIO_CONSOLE_PORT:=59001}"
    : "${MINIO_ROOT_USER:=chat-local-admin}"
    : "${MINIO_ROOT_PASSWORD:=change-me-minio-local-only}"

    : "${OBJECT_STORAGE_ENDPOINT:=http://${MINIO_HOST}:${MINIO_API_PORT}}"
    : "${OBJECT_STORAGE_ACCESS_KEY:=${MINIO_ROOT_USER}}"
    : "${OBJECT_STORAGE_SECRET_KEY:=${MINIO_ROOT_PASSWORD}}"
    : "${OBJECT_STORAGE_OBJECTS_BUCKET:=chat-objects}"
    : "${OBJECT_STORAGE_BACKUPS_BUCKET:=chat-backups}"

    export \
        CHAT_ENV CHAT_LOG_LEVEL \
        POSTGRES_HOST POSTGRES_PORT POSTGRES_ADMIN_USER \
        VALKEY_HOST VALKEY_PORT VALKEY_URL \
        MINIO_HOST MINIO_API_PORT MINIO_CONSOLE_PORT \
        MINIO_ROOT_USER MINIO_ROOT_PASSWORD \
        OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_ACCESS_KEY \
        OBJECT_STORAGE_SECRET_KEY OBJECT_STORAGE_OBJECTS_BUCKET \
        OBJECT_STORAGE_BACKUPS_BUCKET

    set +a
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "Missing required command: $1" >&2
        return 1
    }
}
