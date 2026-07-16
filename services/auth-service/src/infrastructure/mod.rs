//! Authentication persistence and account-directory service adapter.
//!
//! `auth-service` owns only `chat_auth`. Account/profile records remain owned
//! by `account-service` and are accessed through its internal local contract.

use anyhow::{Context, Result, anyhow, bail};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use time::OffsetDateTime;
use uuid::Uuid;

use chat_server_core::auth::{AuthenticatedSession, hash_access_token};

use crate::domain::{Account, LoginIdentity, Registration};

const AUTH_MIGRATION: &str =
    include_str!("../../../../infra/native/postgresql/migrations/auth/0001_password_sessions.sql");
const INTERNAL_TOKEN_HEADER: &str = "x-chat-internal-token";

#[derive(Clone)]
pub(crate) struct AuthRepository {
    auth_pool: PgPool,
}

#[derive(Clone)]
pub(crate) struct AccountDirectoryClient {
    client: reqwest::Client,
    base_url: String,
    internal_token: String,
}

#[derive(Debug, Deserialize)]
struct AccountWire {
    account_id: Uuid,
    username: String,
    display_name: String,
    chat_id: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
struct CreateAccountRequest<'a> {
    account_id: Uuid,
    username: &'a str,
    username_normalized: &'a str,
    display_name: &'a str,
}

#[derive(Debug, Serialize)]
struct UpdateDisplayNameRequest<'a> {
    display_name: &'a str,
}

impl AuthRepository {
    pub(crate) async fn connect() -> Result<Self> {
        let auth_url = chat_foundation_config::required("AUTH_DATABASE_URL")
            .context("AUTH_DATABASE_URL is required")?;
        let auth_pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(&auth_url)
            .await
            .context("failed to connect to authentication database")?;

        sqlx::raw_sql(AUTH_MIGRATION)
            .execute(&auth_pool)
            .await
            .context("failed to apply authentication migration")?;

        Ok(Self { auth_pool })
    }

    pub(crate) async fn healthcheck(&self) -> Result<()> {
        sqlx::query("SELECT 1")
            .execute(&self.auth_pool)
            .await
            .context("authentication database healthcheck failed")?;
        Ok(())
    }

    pub(crate) async fn credential_exists(&self, account_id: Uuid) -> Result<bool> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM account_credentials WHERE account_id = $1)")
            .bind(account_id)
            .fetch_one(&self.auth_pool)
            .await
            .context("failed to check account credential")
    }

    pub(crate) async fn create_credential(
        &self,
        account_id: Uuid,
        password_hash: &str,
    ) -> Result<()> {
        sqlx::query(
            r"
            INSERT INTO account_credentials (account_id, password_hash)
            VALUES ($1, $2)
            ",
        )
        .bind(account_id)
        .bind(password_hash)
        .execute(&self.auth_pool)
        .await
        .context("failed to create account credential")?;
        Ok(())
    }

    pub(crate) async fn delete_credential(&self, account_id: Uuid) -> Result<()> {
        sqlx::query("DELETE FROM account_credentials WHERE account_id = $1")
            .bind(account_id)
            .execute(&self.auth_pool)
            .await
            .context("failed to delete account credential")?;
        Ok(())
    }

    pub(crate) async fn find_login_identity(
        &self,
        account: Account,
    ) -> Result<Option<LoginIdentity>> {
        let password_hash = sqlx::query_scalar::<_, String>(
            "SELECT password_hash FROM account_credentials WHERE account_id = $1",
        )
        .bind(account.account_id)
        .fetch_optional(&self.auth_pool)
        .await
        .context("failed to load account credential")?;

        Ok(password_hash.map(|password_hash| LoginIdentity {
            account,
            password_hash,
        }))
    }

    pub(crate) async fn create_session(
        &self,
        account_id: Uuid,
        token_hash: Vec<u8>,
        expires_at: OffsetDateTime,
    ) -> Result<Uuid> {
        let session_id = Uuid::now_v7();
        sqlx::query(
            r"
            INSERT INTO auth_sessions (
                session_id,
                account_id,
                token_hash,
                expires_at
            )
            VALUES ($1, $2, $3, $4)
            ",
        )
        .bind(session_id)
        .bind(account_id)
        .bind(token_hash)
        .bind(expires_at)
        .execute(&self.auth_pool)
        .await
        .context("failed to create authentication session")?;
        Ok(session_id)
    }

    pub(crate) async fn authenticate_token(
        &self,
        token: &str,
    ) -> Result<Option<AuthenticatedSession>> {
        let token_hash = hash_access_token(token);
        let row = sqlx::query(
            r"
            SELECT session_id, account_id, expires_at
            FROM auth_sessions
            WHERE token_hash = $1
              AND revoked_at IS NULL
              AND expires_at > now()
            ",
        )
        .bind(token_hash)
        .fetch_optional(&self.auth_pool)
        .await
        .context("failed to validate authentication session")?;

        let Some(row) = row else {
            return Ok(None);
        };

        Ok(Some(AuthenticatedSession {
            session_id: row.try_get("session_id")?,
            account_id: row.try_get("account_id")?,
            expires_at: row.try_get("expires_at")?,
        }))
    }

    pub(crate) async fn revoke_session(&self, session_id: Uuid) -> Result<()> {
        sqlx::query(
            r"
            UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, now())
            WHERE session_id = $1
            ",
        )
        .bind(session_id)
        .execute(&self.auth_pool)
        .await
        .context("failed to revoke authentication session")?;
        Ok(())
    }
}

impl AccountDirectoryClient {
    pub(crate) fn connect_from_env() -> Result<Self> {
        let address = chat_foundation_config::required("ACCOUNT_SERVICE_ADDR")
            .context("ACCOUNT_SERVICE_ADDR is required")?;
        let internal_token = chat_foundation_config::required("CHAT_INTERNAL_SERVICE_TOKEN")
            .context("CHAT_INTERNAL_SERVICE_TOKEN is required")?;
        if internal_token.trim().is_empty() {
            bail!("CHAT_INTERNAL_SERVICE_TOKEN must not be empty");
        }

        Ok(Self {
            client: reqwest::Client::new(),
            base_url: local_http_base(&address)?,
            internal_token,
        })
    }

    pub(crate) async fn find_by_username(
        &self,
        username_normalized: &str,
    ) -> Result<Option<Account>> {
        let url = format!(
            "{}/v1/internal/accounts/by-username/{}",
            self.base_url, username_normalized
        );
        self.get_optional(url).await
    }

    pub(crate) async fn get(&self, account_id: Uuid) -> Result<Option<Account>> {
        let url = format!("{}/v1/internal/accounts/{account_id}", self.base_url);
        self.get_optional(url).await
    }

    pub(crate) async fn create(
        &self,
        account_id: Uuid,
        registration: &Registration,
    ) -> Result<Account> {
        let response = self
            .client
            .post(format!("{}/v1/internal/accounts", self.base_url))
            .header(INTERNAL_TOKEN_HEADER, &self.internal_token)
            .json(&CreateAccountRequest {
                account_id,
                username: &registration.username,
                username_normalized: &registration.username_normalized,
                display_name: &registration.display_name,
            })
            .send()
            .await
            .context("failed to call account-service create account")?;
        decode_account_response(response, "create account").await
    }

    pub(crate) async fn update_display_name(
        &self,
        account_id: Uuid,
        display_name: &str,
    ) -> Result<Account> {
        let response = self
            .client
            .patch(format!(
                "{}/v1/internal/accounts/{account_id}/display-name",
                self.base_url
            ))
            .header(INTERNAL_TOKEN_HEADER, &self.internal_token)
            .json(&UpdateDisplayNameRequest { display_name })
            .send()
            .await
            .context("failed to call account-service update display name")?;
        decode_account_response(response, "update display name").await
    }

    pub(crate) async fn delete(&self, account_id: Uuid) -> Result<()> {
        let response = self
            .client
            .delete(format!(
                "{}/v1/internal/accounts/{account_id}",
                self.base_url
            ))
            .header(INTERNAL_TOKEN_HEADER, &self.internal_token)
            .send()
            .await
            .context("failed to call account-service delete account")?;
        if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
            return Ok(());
        }
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(anyhow!(
            "account-service delete account failed with HTTP {status}: {body}"
        ))
    }

    async fn get_optional(&self, url: String) -> Result<Option<Account>> {
        let response = self
            .client
            .get(url)
            .header(INTERNAL_TOKEN_HEADER, &self.internal_token)
            .send()
            .await
            .context("failed to call account-service")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        decode_account_response(response, "load account")
            .await
            .map(Some)
    }
}

async fn decode_account_response(response: reqwest::Response, operation: &str) -> Result<Account> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "account-service {operation} failed with HTTP {status}: {body}"
        ));
    }
    let wire = response
        .json::<AccountWire>()
        .await
        .with_context(|| format!("account-service returned invalid {operation} response"))?;
    Account::try_from(wire)
}

impl TryFrom<AccountWire> for Account {
    type Error = anyhow::Error;

    fn try_from(wire: AccountWire) -> Result<Self> {
        let created_at = OffsetDateTime::parse(
            &wire.created_at,
            &time::format_description::well_known::Rfc3339,
        )
        .context("account-service returned invalid created_at")?;
        Ok(Self {
            account_id: wire.account_id,
            username: wire.username,
            display_name: wire.display_name,
            chat_id: wire.chat_id,
            created_at,
        })
    }
}

fn local_http_base(address: &str) -> Result<String> {
    let address = address.trim().trim_end_matches('/');
    if address.is_empty() {
        bail!("ACCOUNT_SERVICE_ADDR is empty");
    }
    if address.starts_with("http://") || address.starts_with("https://") {
        return Ok(address.to_owned());
    }
    Ok(format!("http://{address}"))
}
