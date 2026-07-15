# Dependency Rules

## 1. Purpose

This document defines the allowed dependency direction for the secure chat
workspace.

The goal is to prevent architecture erosion, accidental coupling, and
security-boundary violations.

---

## 2. High-Level Dependency Direction

```text
frontends
    |
    v
client/facade
    |
    v
client/core
    |
    +--------------------+
    |                    |
    v                    v
privacy               protocol
    |                    |
    +----------+---------+
               |
               v
           crypto/api

client/core
    |
    v
storage/core

platform-specific implementations
    |
    v
platform/api

Server-side:

services/*
    |
    v
server/core
    |
    +--------------------+
    |                    |
    v                    v
protocol             storage/core
    |
    v
foundation
3. Foundation Layer

The foundation layer contains the lowest-level shared infrastructure.

foundation/common
foundation/errors
foundation/config
foundation/telemetry
foundation/common

May contain:

identifiers
byte wrappers
time abstractions
version types
small dependency-free or low-dependency value types

Must not depend on:

client
server
protocol
privacy
transport
storage
platform implementations
concrete crypto providers
foundation/errors

Contains shared low-level error definitions.

Must remain low dependency.

foundation/config

May depend on:

foundation/common
foundation/errors

Must not depend on:

telemetry
client
server
storage implementations
concrete crypto providers
foundation/telemetry

May depend on:

foundation/common
foundation/errors

Must not log:

plaintext messages
cryptographic keys
authentication secrets
attachment plaintext
ratchet state
recovery keys
raw contact discovery inputs
4. Cryptography
crypto/api
    ^
    |
concrete providers

Allowed:

crypto/pairwise-provider -> crypto/api
crypto/mls-provider -> crypto/api
crypto/opaque-provider -> crypto/api
crypto/key-transparency-provider -> crypto/api

Forbidden:

crypto/api -> concrete provider

Business code must depend on provider abstractions rather than directly on
concrete cryptographic library internals.

5. Client
frontends
    |
    v
client/facade
    |
    v
client/core

Forbidden:

client/core -> React
client/core -> Tauri UI components
client/core -> Android UI

The client core must remain UI-independent.

6. Storage
client/core
    |
    v
storage/core
    ^
    |
storage/client

Server-side:

services
    |
    v
server/core
    |
    v
storage/core
    ^
    |
storage/server

A service must never directly access another service's database.

7. Server Services

Each service owns its persistence boundary.

Examples:

auth-service
    ->
chat_auth database

key-directory
    ->
chat_key_directory database

key-transparency
    ->
chat_key_transparency database

mailbox-store
    ->
chat_mailbox database

Forbidden:

auth-service -> chat_mailbox database

mailbox-store -> chat_auth database

service A -> service B private tables

Cross-service communication must use defined service contracts.

8. Forbidden Generic Utility Crates

Do not create catch-all crates or modules such as:

utils
helpers
misc
everything
common-utils

Shared code must have a specific architectural responsibility.

9. Dependency Addition Policy

Before adding a new external dependency:

Confirm its architectural owner.
Confirm the dependency is necessary.
Check maintenance status.
Check license compatibility.
Check known security advisories.
Avoid enabling unnecessary default features.
Prefer workspace-managed versions.
For cryptographic dependencies, require explicit security review.
10. Security Boundary Rule

Directory separation alone is not a security boundary.

Boundaries must also be enforced through:

Rust crate dependencies
service API contracts
database credentials
database ownership
cryptographic key domains
configuration separation
tests
CI checks
