CREATE TABLE IF NOT EXISTS account_ui_preferences (
    account_id UUID PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    locale TEXT NOT NULL DEFAULT 'zh-CN' CHECK (locale IN ('zh-CN', 'en')),
    theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
    font_size_level SMALLINT NOT NULL DEFAULT 1 CHECK (font_size_level BETWEEN 0 AND 8),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
