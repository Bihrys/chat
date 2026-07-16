//! PostgreSQL persistence for identity records, exact discovery, and contacts.

use anyhow::{Context, Result, anyhow};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use uuid::Uuid;

use crate::domain::{Account, FriendRequestMailbox, FriendRequestRecord, FriendRequestStatus};

const ACCOUNT_MIGRATION: &str =
    include_str!("../../../../infra/native/postgresql/migrations/identity/0001_basic_accounts.sql");
const SOCIAL_MIGRATION: &str =
    include_str!("../../../../infra/native/postgresql/migrations/identity/0002_social_graph.sql");
const PROFILE_CONTACT_MIGRATION: &str =
    include_str!("../../../../infra/native/postgresql/migrations/identity/0003_profile_contacts.sql");

#[derive(Clone)]
pub(crate) struct AccountRepository {
    pool: PgPool,
}

impl AccountRepository {
    pub(crate) async fn connect() -> Result<Self> {
        let database_url = chat_foundation_config::required("IDENTITY_DATABASE_URL")
            .context("IDENTITY_DATABASE_URL is required")?;
        let pool = PgPoolOptions::new()
            .max_connections(12)
            .connect(&database_url)
            .await
            .context("failed to connect to identity database")?;

        sqlx::raw_sql(ACCOUNT_MIGRATION)
            .execute(&pool)
            .await
            .context("failed to apply identity migration")?;
        sqlx::raw_sql(SOCIAL_MIGRATION)
            .execute(&pool)
            .await
            .context("failed to apply social graph migration")?;
        sqlx::raw_sql(PROFILE_CONTACT_MIGRATION)
            .execute(&pool)
            .await
            .context("failed to apply profile/contact migration")?;

        Ok(Self { pool })
    }

    pub(crate) async fn healthcheck(&self) -> Result<()> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .context("identity database healthcheck failed")?;
        Ok(())
    }

    pub(crate) async fn create(
        &self,
        account_id: Uuid,
        username: &str,
        username_normalized: &str,
        display_name: &str,
    ) -> Result<Account> {
        let chat_id = public_chat_id(account_id);
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("failed to begin account transaction")?;
        let row = sqlx::query(
            r"
            INSERT INTO accounts (account_id, status)
            VALUES ($1, 1)
            RETURNING created_at
            ",
        )
        .bind(account_id)
        .fetch_one(&mut *transaction)
        .await
        .context("failed to create account")?;
        let created_at = row
            .try_get("created_at")
            .context("missing account created_at")?;

        sqlx::query(
            r"
            INSERT INTO account_profiles (
                account_id,
                username,
                username_normalized,
                display_name,
                chat_id
            )
            VALUES ($1, $2, $3, $4, $5)
            ",
        )
        .bind(account_id)
        .bind(username)
        .bind(username_normalized)
        .bind(display_name)
        .bind(&chat_id)
        .execute(&mut *transaction)
        .await
        .context("failed to create account profile")?;

        transaction
            .commit()
            .await
            .context("failed to commit account transaction")?;

        Ok(Account {
            account_id,
            username: username.to_owned(),
            display_name: display_name.to_owned(),
            chat_id,
            avatar_data_url: None,
            remark_name: None,
            source: None,
            created_at,
        })
    }

    pub(crate) async fn get(&self, account_id: Uuid) -> Result<Option<Account>> {
        let row = sqlx::query(
            r"
            SELECT a.account_id, p.username, p.display_name, p.chat_id,
                   p.avatar_data_url, NULL::text AS remark_name, NULL::text AS source,
                   a.created_at
            FROM accounts a
            JOIN account_profiles p ON p.account_id = a.account_id
            WHERE a.account_id = $1
              AND a.deleted_at IS NULL
              AND a.status = 1
            ",
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch account")?;
        row.map(row_to_account).transpose()
    }

    pub(crate) async fn get_by_username(
        &self,
        username_normalized: &str,
    ) -> Result<Option<Account>> {
        let row = sqlx::query(
            r"
            SELECT a.account_id, p.username, p.display_name, p.chat_id,
                   p.avatar_data_url, NULL::text AS remark_name, NULL::text AS source,
                   a.created_at
            FROM accounts a
            JOIN account_profiles p ON p.account_id = a.account_id
            WHERE p.username_normalized = $1
              AND a.deleted_at IS NULL
              AND a.status = 1
            ",
        )
        .bind(username_normalized)
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch account by username")?;
        row.map(row_to_account).transpose()
    }

    pub(crate) async fn lookup_exact(&self, identifier: &str) -> Result<Option<Account>> {
        if let Ok(account_id) = Uuid::parse_str(identifier) {
            return self.get(account_id).await;
        }
        let row = sqlx::query(
            r"
            SELECT a.account_id, p.username, p.display_name, p.chat_id,
                   p.avatar_data_url, NULL::text AS remark_name, NULL::text AS source,
                   a.created_at
            FROM accounts a
            JOIN account_profiles p ON p.account_id = a.account_id
            WHERE upper(p.chat_id) = upper($1)
              AND a.deleted_at IS NULL
              AND a.status = 1
            ",
        )
        .bind(identifier)
        .fetch_optional(&self.pool)
        .await
        .context("failed to look up account")?;
        row.map(row_to_account).transpose()
    }

    pub(crate) async fn update_display_name(
        &self,
        account_id: Uuid,
        display_name: &str,
    ) -> Result<Option<Account>> {
        let updated = sqlx::query(
            r"
            UPDATE account_profiles p
            SET display_name = $2, updated_at = now()
            FROM accounts a
            WHERE p.account_id = $1
              AND a.account_id = p.account_id
              AND a.deleted_at IS NULL
              AND a.status = 1
            ",
        )
        .bind(account_id)
        .bind(display_name)
        .execute(&self.pool)
        .await
        .context("failed to update display name")?;
        if updated.rows_affected() == 0 {
            return Ok(None);
        }
        self.get(account_id).await
    }

    pub(crate) async fn update_avatar(
        &self,
        account_id: Uuid,
        avatar_data_url: Option<&str>,
    ) -> Result<Option<Account>> {
        let updated = sqlx::query(
            r"
            UPDATE account_profiles p
            SET avatar_data_url = $2, updated_at = now()
            FROM accounts a
            WHERE p.account_id = $1
              AND a.account_id = p.account_id
              AND a.deleted_at IS NULL
              AND a.status = 1
            ",
        )
        .bind(account_id)
        .bind(avatar_data_url)
        .execute(&self.pool)
        .await
        .context("failed to update avatar")?;
        if updated.rows_affected() == 0 {
            return Ok(None);
        }
        self.get(account_id).await
    }

    pub(crate) async fn get_contact(&self, actor: Uuid, contact: Uuid) -> Result<Option<Account>> {
        let row = sqlx::query(
            r"
            SELECT a.account_id, p.username, p.display_name, p.chat_id,
                   p.avatar_data_url, c.remark_name, c.source, a.created_at
            FROM contacts c
            JOIN accounts a ON a.account_id = c.contact_account_id
            JOIN account_profiles p ON p.account_id = a.account_id
            WHERE c.account_id = $1
              AND c.contact_account_id = $2
              AND a.deleted_at IS NULL
              AND a.status = 1
            ",
        )
        .bind(actor)
        .bind(contact)
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch contact")?;
        row.map(row_to_account).transpose()
    }

    pub(crate) async fn update_contact_remark(
        &self,
        actor: Uuid,
        contact: Uuid,
        remark_name: Option<&str>,
    ) -> Result<Option<Account>> {
        let result = sqlx::query(
            r"
            UPDATE contacts
            SET remark_name = $3
            WHERE account_id = $1 AND contact_account_id = $2
            ",
        )
        .bind(actor)
        .bind(contact)
        .bind(remark_name)
        .execute(&self.pool)
        .await
        .context("failed to update contact remark")?;
        if result.rows_affected() == 0 {
            return Ok(None);
        }
        self.get_contact(actor, contact).await
    }

    pub(crate) async fn delete(&self, account_id: Uuid) -> Result<bool> {
        let result = sqlx::query("DELETE FROM accounts WHERE account_id = $1")
            .bind(account_id)
            .execute(&self.pool)
            .await
            .context("failed to delete account")?;
        Ok(result.rows_affected() > 0)
    }

    pub(crate) async fn list_contacts(&self, actor: Uuid) -> Result<Vec<Account>> {
        let rows = sqlx::query(
            r"
            SELECT a.account_id, p.username, p.display_name, p.chat_id,
                   p.avatar_data_url, c.remark_name, c.source, a.created_at
            FROM contacts c
            JOIN accounts a ON a.account_id = c.contact_account_id
            JOIN account_profiles p ON p.account_id = a.account_id
            WHERE c.account_id = $1
              AND a.deleted_at IS NULL
              AND a.status = 1
            ORDER BY lower(COALESCE(c.remark_name, p.display_name)), p.chat_id
            ",
        )
        .bind(actor)
        .fetch_all(&self.pool)
        .await
        .context("failed to list contacts")?;
        rows.into_iter().map(row_to_account).collect()
    }

    pub(crate) async fn are_contacts(&self, left: Uuid, right: Uuid) -> Result<bool> {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM contacts WHERE account_id = $1 AND contact_account_id = $2)",
        )
        .bind(left)
        .bind(right)
        .fetch_one(&self.pool)
        .await
        .context("failed to verify contact relationship")
    }

    pub(crate) async fn pending_request_exists(&self, left: Uuid, right: Uuid) -> Result<bool> {
        sqlx::query_scalar(
            r"
            SELECT EXISTS(
                SELECT 1 FROM friend_requests
                WHERE status = 0
                  AND ((sender_account_id = $1 AND recipient_account_id = $2)
                    OR (sender_account_id = $2 AND recipient_account_id = $1))
            )
            ",
        )
        .bind(left)
        .bind(right)
        .fetch_one(&self.pool)
        .await
        .context("failed to check pending friend request")
    }

    pub(crate) async fn create_friend_request(
        &self,
        sender: Uuid,
        recipient: Uuid,
        message: &str,
    ) -> Result<Uuid> {
        let request_id = Uuid::now_v7();
        sqlx::query(
            r"
            INSERT INTO friend_requests (
                request_id, sender_account_id, recipient_account_id, message, status
            )
            VALUES ($1, $2, $3, $4, 0)
            ",
        )
        .bind(request_id)
        .bind(sender)
        .bind(recipient)
        .bind(message)
        .execute(&self.pool)
        .await
        .context("failed to create friend request")?;
        Ok(request_id)
    }

    pub(crate) async fn list_friend_requests(&self, actor: Uuid) -> Result<FriendRequestMailbox> {
        let rows = sqlx::query(
            r"
            SELECT
                fr.request_id,
                fr.sender_account_id,
                fr.recipient_account_id,
                fr.message,
                fr.status,
                fr.created_at,
                fr.updated_at,
                peer.account_id AS peer_account_id,
                peer_profile.username AS peer_username,
                peer_profile.display_name AS peer_display_name,
                peer_profile.chat_id AS peer_chat_id,
                peer_profile.avatar_data_url AS peer_avatar_data_url,
                peer.created_at AS peer_created_at
            FROM friend_requests fr
            JOIN accounts peer ON peer.account_id = CASE
                WHEN fr.sender_account_id = $1 THEN fr.recipient_account_id
                ELSE fr.sender_account_id
            END
            JOIN account_profiles peer_profile ON peer_profile.account_id = peer.account_id
            WHERE fr.sender_account_id = $1 OR fr.recipient_account_id = $1
            ORDER BY fr.created_at DESC
            ",
        )
        .bind(actor)
        .fetch_all(&self.pool)
        .await
        .context("failed to list friend requests")?;

        let mut incoming = Vec::new();
        let mut outgoing = Vec::new();
        for row in rows {
            let sender_account_id: Uuid = row.try_get("sender_account_id")?;
            let status_value: i16 = row.try_get("status")?;
            let status = FriendRequestStatus::from_i16(status_value)
                .ok_or_else(|| anyhow!("invalid friend request status {status_value}"))?;
            let record = FriendRequestRecord {
                request_id: row.try_get("request_id")?,
                sender_account_id,
                recipient_account_id: row.try_get("recipient_account_id")?,
                message: row.try_get("message")?,
                status,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
                peer: Account {
                    account_id: row.try_get("peer_account_id")?,
                    username: row.try_get("peer_username")?,
                    display_name: row.try_get("peer_display_name")?,
                    chat_id: row.try_get("peer_chat_id")?,
                    avatar_data_url: row.try_get("peer_avatar_data_url")?,
                    remark_name: None,
                    source: None,
                    created_at: row.try_get("peer_created_at")?,
                },
            };
            if sender_account_id == actor {
                outgoing.push(record);
            } else {
                incoming.push(record);
            }
        }
        Ok(FriendRequestMailbox { incoming, outgoing })
    }

    pub(crate) async fn respond_friend_request(
        &self,
        request_id: Uuid,
        actor: Uuid,
        accept: bool,
    ) -> Result<bool> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("failed to begin friend request response transaction")?;
        let row = sqlx::query(
            r"
            SELECT sender_account_id, recipient_account_id, status
            FROM friend_requests
            WHERE request_id = $1
            FOR UPDATE
            ",
        )
        .bind(request_id)
        .fetch_optional(&mut *transaction)
        .await
        .context("failed to load friend request")?;
        let Some(row) = row else {
            return Ok(false);
        };
        let sender: Uuid = row.try_get("sender_account_id")?;
        let recipient: Uuid = row.try_get("recipient_account_id")?;
        let status: i16 = row.try_get("status")?;
        if recipient != actor || status != 0 {
            return Ok(false);
        }

        let new_status = if accept { 1_i16 } else { 2_i16 };
        sqlx::query(
            "UPDATE friend_requests SET status = $2, updated_at = now() WHERE request_id = $1",
        )
        .bind(request_id)
        .bind(new_status)
        .execute(&mut *transaction)
        .await
        .context("failed to update friend request")?;

        if accept {
            for (account_id, contact_account_id) in [(sender, recipient), (recipient, sender)] {
                sqlx::query(
                    r"
                    INSERT INTO contacts (account_id, contact_account_id)
                    VALUES ($1, $2)
                    ON CONFLICT (account_id, contact_account_id) DO NOTHING
                    ",
                )
                .bind(account_id)
                .bind(contact_account_id)
                .execute(&mut *transaction)
                .await
                .context("failed to create contact relationship")?;
            }
        }
        transaction
            .commit()
            .await
            .context("failed to commit friend request response")?;
        Ok(true)
    }
}

fn public_chat_id(account_id: Uuid) -> String {
    let compact = account_id.simple().to_string().to_ascii_uppercase();
    format!("C{}", &compact[..12])
}

fn row_to_account(row: sqlx::postgres::PgRow) -> Result<Account> {
    Ok(Account {
        account_id: row.try_get("account_id")?,
        username: row.try_get("username")?,
        display_name: row.try_get("display_name")?,
        chat_id: row.try_get("chat_id")?,
        avatar_data_url: row.try_get("avatar_data_url")?,
        remark_name: row.try_get("remark_name")?,
        source: row.try_get("source")?,
        created_at: row.try_get("created_at")?,
    })
}
