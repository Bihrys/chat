# Development Configuration Complete

This repository is configured so implementation work can begin without another architecture/bootstrap pass.

## Configured

- 72-package Rust workspace with workspace-managed internal dependencies.
- Enforced dependency boundaries and cycle detection.
- Shared foundation, protocol, crypto API, privacy, transport, storage, client, server, platform, media, backup, and testing layers.
- Runnable Axum development shell for all 22 services with `/healthz` and `/readyz`.
- Project-local PostgreSQL lifecycle, 10 isolated databases, dedicated roles, password application from `.env`, database hardening, and login verification.
- Project-local Valkey lifecycle.
- Native MinIO install/start/stop/status and bucket initialization.
- Unified infrastructure and service process commands.
- `cargo xtask` command surface.
- Linux and Windows React + Vite + Tauri desktop shells.
- Workspace checks, dependency checks, security checks, CI, sccache, rustfmt, Clippy, Nextest, audit and deny entry points.
- Native `systemd --user` infrastructure templates.

## Intentionally not implemented here

Configuration is complete; product implementation is not. The following are engineering work, not missing bootstrap:

- Pairwise E2EE protocol implementation and audited provider selection.
- MLS group cryptography implementation.
- OPAQUE implementation.
- Key Transparency proof implementation.
- CELL_V1, envelope, object and control protocol codecs.
- Strong-privacy traffic scheduler and QUIC/OHTTP/tunnel implementations.
- SQL schemas, repositories and migrations for each domain.
- Client state machines, messaging flows, UI features and platform integrations.

Those are the software itself and can now be implemented inside the configured boundaries.

## First commands

```bash
cargo xtask bootstrap
cargo xtask check
cargo xtask linux dev
```
