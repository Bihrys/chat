-- Local-development social graph and public chat identifiers.
-- Public chat IDs are exact-match lookup identifiers. Display names are never
-- exposed through directory-style fuzzy search.

ALTER TABLE account_profiles
    ADD COLUMN IF NOT EXISTS chat_id TEXT;

UPDATE account_profiles
SET chat_id = 'C' || upper(substr(replace(account_id::text, '-', ''), 1, 12))
WHERE chat_id IS NULL OR btrim(chat_id) = '';

ALTER TABLE account_profiles
    ALTER COLUMN chat_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_profiles_chat_id
    ON account_profiles(chat_id);

CREATE TABLE IF NOT EXISTS friend_requests (
    request_id UUID PRIMARY KEY,
    sender_account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    recipient_account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    status SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (sender_account_id <> recipient_account_id),
    CHECK (status BETWEEN 0 AND 3),
    CHECK (char_length(message) BETWEEN 1 AND 240)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_one_pending_pair
    ON friend_requests (
        LEAST(sender_account_id, recipient_account_id),
        GREATEST(sender_account_id, recipient_account_id)
    )
    WHERE status = 0;

CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient_pending
    ON friend_requests(recipient_account_id, created_at DESC)
    WHERE status = 0;

CREATE INDEX IF NOT EXISTS idx_friend_requests_sender
    ON friend_requests(sender_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contacts (
    account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    contact_account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, contact_account_id),
    CHECK (account_id <> contact_account_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_contact_account
    ON contacts(contact_account_id, account_id);
