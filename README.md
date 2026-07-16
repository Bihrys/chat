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

## Start developing the current Basic Chat V0 slice

```bash
cargo xtask infra up
cargo xtask chat up
cargo xtask chat smoke
cargo xtask linux dev
```

The current vertical slice intentionally uses `plaintext_dev_v0` only under
`CHAT_ENV=local` so the chat product loop can be completed before E2EE is
inserted. Do not expose the development chat endpoints to an untrusted network.
See `docs/development/BASIC-CHAT-V0.md`.

## Useful commands

```bash
cargo xtask check
cargo xtask infra status
cargo xtask chat up
cargo xtask chat status
cargo xtask chat smoke
cargo xtask chat down
cargo xtask services start all
cargo xtask services status all
cargo xtask services stop all
./scripts/dev/security-check.sh
```

See `docs/development/START-HERE.md` and `docs/architecture/dependency-rules.md`.
