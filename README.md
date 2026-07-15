# Chat

High-privacy end-to-end encrypted communication system monorepo.

## Current development target

1. Linux desktop
2. Windows desktop
3. Android

The shared application backend is written in Rust. Desktop shells use Tauri + React. Local infrastructure is native PostgreSQL + Valkey + MinIO; Docker is not required.

## First setup

```bash
./scripts/bootstrap/bootstrap-arch.sh
cargo xtask bootstrap
cargo xtask check
```

## Start developing the Linux desktop app

```bash
cargo xtask infra up
cargo xtask linux dev
```

## Useful commands

```bash
cargo xtask check
cargo xtask infra status
cargo xtask services start all
cargo xtask services status all
cargo xtask services stop all
./scripts/dev/security-check.sh
```

See `docs/development/START-HERE.md` and `docs/architecture/dependency-rules.md`.
