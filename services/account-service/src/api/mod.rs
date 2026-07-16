//! HTTP API for local development accounts.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    middleware,
    routing::get,
};
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use chat_server_core::{ApiError, local_dev_cors};

use crate::{
    application::{normalize_search_query, validate_new_account},
    domain::Account,
    infrastructure::AccountRepository,
};

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) accounts: AccountRepository,
}

#[derive(Debug, Deserialize)]
struct CreateAccountRequest {
    username: String,
    display_name: String,
}

#[derive(Debug, Deserialize)]
struct ListAccountsQuery {
    query: Option<String>,
    limit: Option<u16>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AccountResponse {
    account_id: Uuid,
    username: String,
    display_name: String,
    created_at: String,
}

pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/v1/dev/accounts", get(list_accounts).post(create_account))
        .route("/v1/dev/accounts/{account_id}", get(get_account))
        .with_state(state)
        .layer(middleware::from_fn(local_dev_cors))
}

async fn healthz() -> &'static str {
    "ok"
}

async fn readyz(State(state): State<AppState>) -> Result<&'static str, ApiError> {
    state
        .accounts
        .healthcheck()
        .await
        .map_err(|error| ApiError::internal(format!("identity database unavailable: {error}")))?;
    Ok("ready")
}

async fn create_account(
    State(state): State<AppState>,
    Json(request): Json<CreateAccountRequest>,
) -> Result<(StatusCode, Json<AccountResponse>), ApiError> {
    ensure_local_mode()?;
    let new_account = validate_new_account(&request.username, &request.display_name)?;

    if state
        .accounts
        .username_exists(&new_account.username_normalized)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::conflict(
            "username_taken",
            "that username is already in use",
        ));
    }

    let account = state.accounts.create(&new_account).await.map_err(|error| {
        tracing::error!(?error, "failed to create local development account");
        ApiError::internal("failed to create account")
    })?;

    Ok((StatusCode::CREATED, Json(account.into())))
}

async fn list_accounts(
    State(state): State<AppState>,
    Query(query): Query<ListAccountsQuery>,
) -> Result<Json<Vec<AccountResponse>>, ApiError> {
    ensure_local_mode()?;
    let limit = i64::from(query.limit.unwrap_or(50).clamp(1, 100));
    let normalized = normalize_search_query(query.query.as_deref());
    let accounts = state
        .accounts
        .list(normalized.as_deref(), limit)
        .await
        .map_err(internal_error)?;

    Ok(Json(accounts.into_iter().map(Into::into).collect()))
}

async fn get_account(
    State(state): State<AppState>,
    Path(account_id): Path<Uuid>,
) -> Result<Json<AccountResponse>, ApiError> {
    ensure_local_mode()?;
    let account = state
        .accounts
        .get(account_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| ApiError::not_found("account_not_found", "account does not exist"))?;

    Ok(Json(account.into()))
}

fn ensure_local_mode() -> Result<(), ApiError> {
    let environment = chat_foundation_config::optional("CHAT_ENV");
    if environment.as_deref() != Some("local") {
        return Err(ApiError::forbidden(
            "development account API is available only when CHAT_ENV=local",
        ));
    }
    Ok(())
}

fn internal_error(error: anyhow::Error) -> ApiError {
    tracing::error!(?error, "account service request failed");
    ApiError::internal("account service request failed")
}

impl From<Account> for AccountResponse {
    fn from(account: Account) -> Self {
        Self {
            account_id: account.account_id,
            username: account.username,
            display_name: account.display_name,
            created_at: format_time(account.created_at),
        }
    }
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .unwrap_or_else(|_| value.unix_timestamp().to_string())
}
