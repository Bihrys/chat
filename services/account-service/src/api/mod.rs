//! Authenticated public account directory and local internal ownership API.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    middleware,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use chat_server_core::{ApiError, auth::SessionVerifier, local_dev_cors};

use crate::{
    application::{normalize_search_query, validate_display_name, validate_internal_account},
    domain::Account,
    infrastructure::AccountRepository,
};

const INTERNAL_TOKEN_HEADER: &str = "x-chat-internal-token";

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) accounts: AccountRepository,
    pub(crate) sessions: SessionVerifier,
    pub(crate) internal_token: Arc<str>,
}

#[derive(Deserialize)]
struct ListAccountsQuery {
    query: Option<String>,
    limit: Option<u16>,
}

#[derive(Deserialize)]
struct CreateInternalAccountRequest {
    account_id: Uuid,
    username: String,
    username_normalized: String,
    display_name: String,
}

#[derive(Deserialize)]
struct UpdateDisplayNameRequest {
    display_name: String,
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
        .route("/v1/accounts", get(list_accounts))
        .route("/v1/accounts/{account_id}", get(get_account))
        .route("/v1/internal/accounts", post(create_internal_account))
        .route(
            "/v1/internal/accounts/by-username/{username_normalized}",
            get(get_internal_account_by_username),
        )
        .route(
            "/v1/internal/accounts/{account_id}",
            get(get_internal_account).delete(delete_internal_account),
        )
        .route(
            "/v1/internal/accounts/{account_id}/display-name",
            axum::routing::patch(update_internal_display_name),
        )
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
    state.sessions.healthcheck().await.map_err(|error| {
        tracing::error!(?error, "account session readiness check failed");
        ApiError::internal("authentication service unavailable")
    })?;
    Ok("ready")
}

async fn list_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListAccountsQuery>,
) -> Result<Json<Vec<AccountResponse>>, ApiError> {
    ensure_local_mode()?;
    state.sessions.authenticate_headers(&headers).await?;

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
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
) -> Result<Json<AccountResponse>, ApiError> {
    ensure_local_mode()?;
    state.sessions.authenticate_headers(&headers).await?;

    let account = state
        .accounts
        .get(account_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;

    Ok(Json(account.into()))
}

async fn create_internal_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateInternalAccountRequest>,
) -> Result<(StatusCode, Json<AccountResponse>), ApiError> {
    authorize_internal(&state, &headers)?;
    validate_internal_account(
        &request.username,
        &request.username_normalized,
        &request.display_name,
    )?;
    let account = state
        .accounts
        .create(
            request.account_id,
            &request.username,
            &request.username_normalized,
            request.display_name.trim(),
        )
        .await
        .map_err(internal_error)?;
    Ok((StatusCode::CREATED, Json(account.into())))
}

async fn get_internal_account_by_username(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(username_normalized): Path<String>,
) -> Result<Json<AccountResponse>, ApiError> {
    authorize_internal(&state, &headers)?;
    let account = state
        .accounts
        .get_by_username(&username_normalized)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn get_internal_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
) -> Result<Json<AccountResponse>, ApiError> {
    authorize_internal(&state, &headers)?;
    let account = state
        .accounts
        .get(account_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn update_internal_display_name(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
    Json(request): Json<UpdateDisplayNameRequest>,
) -> Result<Json<AccountResponse>, ApiError> {
    authorize_internal(&state, &headers)?;
    validate_display_name(&request.display_name)?;
    let account = state
        .accounts
        .update_display_name(account_id, request.display_name.trim())
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn delete_internal_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    authorize_internal(&state, &headers)?;
    if state
        .accounts
        .delete(account_id)
        .await
        .map_err(internal_error)?
    {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(account_not_found())
    }
}

fn authorize_internal(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    ensure_local_mode()?;
    let supplied = headers
        .get(INTERNAL_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !constant_time_equal(supplied.as_bytes(), state.internal_token.as_bytes()) {
        return Err(ApiError::unauthorized(
            "invalid internal service credential",
        ));
    }
    Ok(())
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (*left ^ *right)
        })
        == 0
}

fn ensure_local_mode() -> Result<(), ApiError> {
    let environment = chat_foundation_config::optional("CHAT_ENV");
    if environment.as_deref() != Some("local") {
        return Err(ApiError::forbidden(
            "account directory is available only when CHAT_ENV=local",
        ));
    }
    Ok(())
}

fn account_not_found() -> ApiError {
    ApiError::not_found("account_not_found", "account does not exist")
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
