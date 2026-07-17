-- Contact-local controls used by the desktop contact profile and privacy menus.

ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS tags TEXT,
    ADD COLUMN IF NOT EXISTS friend_permission SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE contacts
    DROP CONSTRAINT IF EXISTS contacts_tags_length,
    DROP CONSTRAINT IF EXISTS contacts_friend_permission_valid;

ALTER TABLE contacts
    ADD CONSTRAINT contacts_tags_length
        CHECK (tags IS NULL OR char_length(tags) BETWEEN 1 AND 256),
    ADD CONSTRAINT contacts_friend_permission_valid
        CHECK (friend_permission IN (0, 1));

CREATE INDEX IF NOT EXISTS contacts_starred_idx
    ON contacts (account_id, is_starred DESC, contact_account_id);

CREATE INDEX IF NOT EXISTS contacts_blocked_idx
    ON contacts (account_id, is_blocked, contact_account_id);
