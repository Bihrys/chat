#!/usr/bin/env python3
from pathlib import Path
from urllib.parse import unquote, urlsplit
import os

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

add("POSTGRES_HOST", "127.0.0.1")
add("POSTGRES_PORT", "55432")
add("POSTGRES_ADMIN_USER", "chat_admin")

pairs = {
    "IDENTITY_DB_PASSWORD": "IDENTITY_DATABASE_URL",
    "AUTH_DB_PASSWORD": "AUTH_DATABASE_URL",
    "KEY_DIRECTORY_DB_PASSWORD": "KEY_DIRECTORY_DATABASE_URL",
    "KEY_TRANSPARENCY_DB_PASSWORD": "KEY_TRANSPARENCY_DATABASE_URL",
    "MAILBOX_DB_PASSWORD": "MAILBOX_DATABASE_URL",
    "OBJECT_DB_PASSWORD": "OBJECT_DATABASE_URL",
    "GROUP_DB_PASSWORD": "GROUP_DATABASE_URL",
    "BACKUP_DB_PASSWORD": "BACKUP_DATABASE_URL",
    "CONFIG_DB_PASSWORD": "CONFIG_DATABASE_URL",
    "DIAGNOSTIC_DB_PASSWORD": "DIAGNOSTIC_DATABASE_URL",
}
for password_key, url_key in pairs.items():
    url = values.get(url_key)
    password = urlsplit(url).password if url else None
    default_name = password_key.lower().replace("_db_password", "").replace("_", "-")
    add(
        password_key,
        unquote(password) if password else f"local-dev-{default_name}-change-me",
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
