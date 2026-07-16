//! PostgreSQL persistence for the local account directory.

use anyhow::{Context, Result};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use uuid::Uuid;

use crate::domain::{Account, NewAccount};

const MIGRATION: &str =
    include_str!("../../../../infra/native/postgresql/migrations/identity/0001_basic_accounts.sql");

#[derive(Clone)]
pub(crate) struct AccountRepository {
    pool: PgPool,
}

impl AccountRepository {
    pub(crate) async fn connect() -> Result<Self> {
        let database_url = chat_foundation_config::required("IDENTITY_DATABASE_URL")
            .context("IDENTITY_DATABASE_URL is required")?;

        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(&database_url)
            .await
            .context("failed to connect to identity database")?;

        sqlx::raw_sql(MIGRATION)
            .execute(&pool)
            .await
            .context("failed to apply identity development migration")?;

        Ok(Self { pool })
    }

    pub(crate) async fn healthcheck(&self) -> Result<()> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .context("identity database healthcheck failed")?;
        Ok(())
    }

    pub(crate) async fn username_exists(&self, username_normalized: &str) -> Result<bool> {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM account_profiles WHERE username_normalized = $1)",
        )
        .bind(username_normalized)
        .fetch_one(&self.pool)
        .await
        .context("failed to check username availability")?;

        Ok(exists)
    }

    pub(crate) async fn create(&self, new_account: &NewAccount) -> Result<Account> {
        let account_id = Uuid::now_v7();
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("failed to begin account transaction")?;

        let row = sqlx::query(
            r#"
            INSERT INTO accounts (account_id, status)
            VALUES ($1, 1)
            RETURNING created_at
            "#,
        )
        .bind(account_id)
        .fetch_one(&mut *transaction)
        .await
        .context("failed to create account")?;

        let created_at = row
            .try_get("created_at")
            .context("missing account created_at")?;

        sqlx::query(
            r#"
            INSERT INTO account_profiles (
                account_id,
                username,
                username_normalized,
                display_name
            )
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(account_id)
        .bind(&new_account.username)
        .bind(&new_account.username_normalized)
        .bind(&new_account.display_name)
        .execute(&mut *transaction)
        .await
        .context("failed to create account profile")?;

        transaction
            .commit()
            .await
            .context("failed to commit account transaction")?;

        Ok(Account {
            account_id,
            username: new_account.username.clone(),
            display_name: new_account.display_name.clone(),
            created_at,
        })
    }

    pub(crate) async fn get(&self, account_id: Uuid) -> Result<Option<Account>> {
        let row = sqlx::query(
            r#"
            SELECT
                a.account_id,
                p.username,
                p.display_name,
                a.created_at
            FROM accounts a
            JOIN account_profiles p ON p.account_id = a.account_id
            WHERE a.account_id = $1
              AND a.deleted_at IS NULL
              AND a.status = 1
            "#,
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch account")?;

        row.map(row_to_account).transpose()
    }

    pub(crate) async fn list(&self, query: Option<&str>, limit: i64) -> Result<Vec<Account>> {
        let rows = if let Some(query) = query {
            let pattern = format!("%{query}%");
            sqlx::query(
                r#"
                SELECT
                    a.account_id,
                    p.username,
                    p.display_name,
                    a.created_at
                FROM accounts a
                JOIN account_profiles p ON p.account_id = a.account_id
                WHERE a.deleted_at IS NULL
                  AND a.status = 1
                  AND (
                    p.username_normalized LIKE $1
                    OR lower(p.display_name) LIKE $1
                  )
                ORDER BY p.username_normalized ASC
                LIMIT $2
                "#,
            )
            .bind(pattern)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .context("failed to search accounts")?
        } else {
            sqlx::query(
                r#"
                SELECT
                    a.account_id,
                    p.username,
                    p.display_name,
                    a.created_at
                FROM accounts a
                JOIN account_profiles p ON p.account_id = a.account_id
                WHERE a.deleted_at IS NULL
                  AND a.status = 1
                ORDER BY a.created_at ASC
                LIMIT $1
                "#,
            )
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .context("failed to list accounts")?
        };

        rows.into_iter().map(row_to_account).collect()
    }
}

fn row_to_account(row: sqlx::postgres::PgRow) -> Result<Account> {
    Ok(Account {
        account_id: row.try_get("account_id")?,
        username: row.try_get("username")?,
        display_name: row.try_get("display_name")?,
        created_at: row.try_get("created_at")?,
    })
}
