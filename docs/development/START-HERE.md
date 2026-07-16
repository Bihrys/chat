# Start Here

## One-time machine bootstrap on Arch Linux

```bash
./scripts/bootstrap/bootstrap-arch.sh
```

## One-time project bootstrap

```bash
cargo xtask bootstrap
```

This initializes or reuses the project-local PostgreSQL cluster, creates isolated databases and service roles, applies local passwords from `.env`, starts Valkey and MinIO, creates object-storage buckets, verifies all database logins, and installs frontend packages.

## Daily development

For the current Basic Chat V0 vertical slice:

```bash
cargo xtask infra up
cargo xtask chat up
cargo xtask chat status
cargo xtask chat smoke
cargo xtask linux dev
```

`chat up` starts the first two domain services with real behavior:
`account-service` and `mailbox-store`. See
[`BASIC-CHAT-V0.md`](./BASIC-CHAT-V0.md) for the local two-client test flow and
the explicit pre-E2EE security boundary.

Run the whole-workspace quality gate separately:

```bash
cargo xtask check
```

## Run service skeletons

```bash
cargo xtask services start all
cargo xtask services status all
cargo xtask services stop all
```

Every service exposes `/healthz` and `/readyz` on the address defined in `.env`. These are development shells; domain implementations belong in each service's `domain`, `application`, `infrastructure`, and `api` modules.

## Architecture rule

The dependency graph is enforced by `scripts/dev/check-dependency-rules.py`. Do not bypass it by creating cross-service Cargo dependencies or by making core abstraction crates depend on concrete implementations.
