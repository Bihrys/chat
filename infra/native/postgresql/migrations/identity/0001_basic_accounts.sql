-- Development vertical slice: account directory used by the first working chat loop.
-- Authentication credentials intentionally do not live in this database.

CREATE TABLE IF NOT EXISTS accounts (
    account_id UUID PRIMARY KEY,
    status SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS account_profiles (
    account_id UUID PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (char_length(username_normalized) BETWEEN 3 AND 32),
    CHECK (char_length(display_name) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS idx_account_profiles_username_normalized
    ON account_profiles(username_normalized);

CREATE INDEX IF NOT EXISTS idx_account_profiles_display_name
    ON account_profiles(display_name);
