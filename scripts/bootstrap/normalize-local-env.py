#!/usr/bin/env python3
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
import os
import secrets

root = Path(__file__).resolve().parents[2]
env_path = root / ".env"
example_path = root / ".env.example"

if not env_path.exists():
    env_path.write_text(example_path.read_text())

lines = env_path.read_text().splitlines()
values: dict[str, str] = {}
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip()

additions: dict[str, str] = {}


def add(key: str, value: str) -> None:
    if key not in values and key not in additions:
        additions[key] = value


def current(key: str, fallback: str) -> str:
    return values.get(key, additions.get(key, fallback))


add("CHAT_ENV", "local")
add("CHAT_LOG_LEVEL", "debug")
add("CHAT_INTERNAL_SERVICE_TOKEN", secrets.token_urlsafe(32))

add("POSTGRES_HOST", "127.0.0.1")
add("POSTGRES_PORT", "55432")
add("POSTGRES_ADMIN_USER", "chat_admin")

database_settings = {
    "IDENTITY": ("chat_identity", "chat_identity"),
    "AUTH": ("chat_auth", "chat_auth"),
    "KEY_DIRECTORY": ("chat_key_directory", "chat_key_directory"),
    "KEY_TRANSPARENCY": ("chat_key_transparency", "chat_key_transparency"),
    "MAILBOX": ("chat_mailbox", "chat_mailbox"),
    "OBJECT": ("chat_object", "chat_object"),
    "GROUP": ("chat_group", "chat_group"),
    "BACKUP": ("chat_backup", "chat_backup"),
    "CONFIG": ("chat_config", "chat_config"),
    "DIAGNOSTIC": ("chat_diagnostic", "chat_diagnostic"),
}

for prefix, (role, database) in database_settings.items():
    password_key = f"{prefix}_DB_PASSWORD"
    url_key = f"{prefix}_DATABASE_URL"
    existing_url = values.get(url_key)
    existing_password = urlsplit(existing_url).password if existing_url else None
    default_name = prefix.lower().replace("_", "-")
    add(
        password_key,
        unquote(existing_password)
        if existing_password
        else f"local-dev-{default_name}-change-me",
    )

    password = quote(current(password_key, f"local-dev-{default_name}-change-me"), safe="")
    host = current("POSTGRES_HOST", "127.0.0.1")
    port = current("POSTGRES_PORT", "55432")
    add(
        url_key,
        f"postgresql://{role}:{password}@{host}:{port}/{database}",
    )

add("VALKEY_HOST", "127.0.0.1")
add("VALKEY_PORT", "56379")
add("VALKEY_URL", f"redis://{current('VALKEY_HOST', '127.0.0.1')}:{current('VALKEY_PORT', '56379')}")

add("MINIO_HOST", "127.0.0.1")
add("MINIO_API_PORT", "59000")
add("MINIO_CONSOLE_PORT", "59001")
add("MINIO_ROOT_USER", "chat-local-admin")
add("MINIO_ROOT_PASSWORD", "change-me-minio-local-only")
add(
    "OBJECT_STORAGE_ENDPOINT",
    f"http://{current('MINIO_HOST', '127.0.0.1')}:{current('MINIO_API_PORT', '59000')}",
)
add("OBJECT_STORAGE_ACCESS_KEY", current("MINIO_ROOT_USER", "chat-local-admin"))
add(
    "OBJECT_STORAGE_SECRET_KEY",
    current("MINIO_ROOT_PASSWORD", "change-me-minio-local-only"),
)
add("OBJECT_STORAGE_OBJECTS_BUCKET", "chat-objects")
add("OBJECT_STORAGE_BACKUPS_BUCKET", "chat-backups")

if additions:
    with env_path.open("a") as fh:
        fh.write("\n# Added automatically by local development bootstrap\n")
        for key, value in additions.items():
            fh.write(f"{key}={value}\n")

os.chmod(env_path, 0o600)
print(f"[OK] normalized {env_path}")
