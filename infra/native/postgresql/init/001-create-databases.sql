\set ON_ERROR_STOP on

-- ============================================================
-- Local development roles
--
-- Passwords are intentionally NOT stored in this file.
-- They are configured separately from the ignored local .env.
-- ============================================================

SELECT 'CREATE ROLE chat_identity LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_identity'
)
\gexec

SELECT 'CREATE ROLE chat_auth LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_auth'
)
\gexec

SELECT 'CREATE ROLE chat_key_directory LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_key_directory'
)
\gexec

SELECT 'CREATE ROLE chat_key_transparency LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_key_transparency'
)
\gexec

SELECT 'CREATE ROLE chat_mailbox LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_mailbox'
)
\gexec

SELECT 'CREATE ROLE chat_object LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_object'
)
\gexec

SELECT 'CREATE ROLE chat_group LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_group'
)
\gexec

SELECT 'CREATE ROLE chat_backup LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_backup'
)
\gexec

SELECT 'CREATE ROLE chat_config LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_config'
)
\gexec

SELECT 'CREATE ROLE chat_diagnostic LOGIN'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chat_diagnostic'
)
\gexec

-- ============================================================
-- Local development databases
-- ============================================================

SELECT 'CREATE DATABASE chat_identity OWNER chat_identity'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_identity'
)
\gexec

SELECT 'CREATE DATABASE chat_auth OWNER chat_auth'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_auth'
)
\gexec

SELECT 'CREATE DATABASE chat_key_directory OWNER chat_key_directory'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_key_directory'
)
\gexec

SELECT 'CREATE DATABASE chat_key_transparency OWNER chat_key_transparency'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_key_transparency'
)
\gexec

SELECT 'CREATE DATABASE chat_mailbox OWNER chat_mailbox'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_mailbox'
)
\gexec

SELECT 'CREATE DATABASE chat_object OWNER chat_object'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_object'
)
\gexec

SELECT 'CREATE DATABASE chat_group OWNER chat_group'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_group'
)
\gexec

SELECT 'CREATE DATABASE chat_backup OWNER chat_backup'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_backup'
)
\gexec

SELECT 'CREATE DATABASE chat_config OWNER chat_config'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_config'
)
\gexec

SELECT 'CREATE DATABASE chat_diagnostic OWNER chat_diagnostic'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'chat_diagnostic'
)
\gexec
