-- Profile avatars and contact-local metadata for the desktop client.

ALTER TABLE account_profiles
    ADD COLUMN IF NOT EXISTS avatar_data_url TEXT;

ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS remark_name TEXT,
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'friend_request';

ALTER TABLE contacts
    DROP CONSTRAINT IF EXISTS contacts_remark_name_length;

ALTER TABLE contacts
    ADD CONSTRAINT contacts_remark_name_length
    CHECK (remark_name IS NULL OR char_length(remark_name) BETWEEN 1 AND 64);
