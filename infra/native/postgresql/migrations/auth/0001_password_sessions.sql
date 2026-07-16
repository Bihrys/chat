-- Local-development authentication credentials and bearer sessions.
-- Account/profile data remains owned by chat_identity; this database stores
-- only password verifiers and revocable session-token digests.

CREATE TABLE IF NOT EXISTS account_credentials (
    account_id UUID PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (char_length(password_hash) BETWEEN 32 AND 1024)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id UUID PRIMARY KEY,
    account_id UUID NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CHECK (octet_length(token_hash) = 32),
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_account_created
    ON auth_sessions(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_expiry
    ON auth_sessions(expires_at)
    WHERE revoked_at IS NULL;
