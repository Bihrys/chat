//! HTTP registration, login, and bearer-session API.

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    middleware,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use chat_server_core::{
    ApiError,
    auth::{AuthenticatedSession, bearer_token, hash_access_token},
    local_dev_cors,
};

use crate::{
    application::{
        generate_access_token, hash_password, normalize_login_username, validate_registration,
        verify_password,
    },
    domain::Account,
    infrastructure::{AccountDirectoryClient, AuthRepository},
};

const SESSION_LIFETIME_DAYS: i64 = 7;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) auth: AuthRepository,
    pub(crate) accounts: AccountDirectoryClient,
}

#[derive(Deserialize)]
struct RegisterRequest {
    username: String,
    display_name: String,
    password: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Clone, Debug, Serialize)]
struct AccountResponse {
    account_id: Uuid,
    username: String,
    display_name: String,
    chat_id: String,
    avatar_data_url: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize)]
struct AuthResponse {
    access_token: String,
    expires_at: String,
    account: AccountResponse,
}

#[derive(Debug, Serialize)]
struct IntrospectionResponse {
    account_id: Uuid,
    session_id: Uuid,
    expires_at: String,
}

pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/v1/auth/register", post(register))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/me", get(me))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/auth/introspect", get(introspect))
        .with_state(state)
        .layer(middleware::from_fn(local_dev_cors))
}

async fn healthz() -> &'static str {
    "ok"
}

async fn readyz(State(state): State<AppState>) -> Result<&'static str, ApiError> {
    state.auth.healthcheck().await.map_err(|error| {
        tracing::error!(?error, "authentication readiness check failed");
        ApiError::internal("authentication database unavailable")
    })?;
    Ok("ready")
}

async fn register(
    State(state): State<AppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), ApiError> {
    ensure_local_mode()?;
    let registration =
        validate_registration(&request.username, &request.display_name, &request.password)?;
    let password_hash = hash_password(&registration.password).map_err(|error| {
        tracing::error!(?error, "failed to hash registration password");
        ApiError::internal("failed to create account")
    })?;

    let existing_account = state
        .accounts
        .find_by_username(&registration.username_normalized)
        .await
        .map_err(account_service_error)?;

    let account = if let Some(existing_account) = existing_account {
        if state
            .auth
            .credential_exists(existing_account.account_id)
            .await
            .map_err(internal_error)?
        {
            return Err(ApiError::conflict(
                "username_taken",
                "that username is already in use",
            ));
        }

        state
            .auth
            .create_credential(existing_account.account_id, &password_hash)
            .await
            .map_err(internal_error)?;
        match state
            .accounts
            .update_display_name(existing_account.account_id, &registration.display_name)
            .await
        {
            Ok(account) => account,
            Err(error) => {
                compensate_credential(&state, existing_account.account_id).await;
                return Err(account_service_error(error));
            }
        }
    } else {
        let account_id = Uuid::now_v7();
        let account = state
            .accounts
            .create(account_id, &registration)
            .await
            .map_err(account_service_error)?;
        if let Err(error) = state
            .auth
            .create_credential(account.account_id, &password_hash)
            .await
        {
            tracing::error!(?error, account_id = %account.account_id, "failed to persist credential after account creation");
            if let Err(cleanup_error) = state.accounts.delete(account.account_id).await {
                tracing::error!(?cleanup_error, account_id = %account.account_id, "failed to compensate account creation");
            }
            return Err(ApiError::internal("failed to create account"));
        }
        account
    };

    let response = issue_session(&state, account).await?;
    Ok((StatusCode::CREATED, Json(response)))
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    ensure_local_mode()?;
    let username_normalized = normalize_login_username(&request.username)?;
    let account = state
        .accounts
        .find_by_username(&username_normalized)
        .await
        .map_err(account_service_error)?
        .ok_or_else(invalid_credentials)?;
    let identity = state
        .auth
        .find_login_identity(account)
        .await
        .map_err(internal_error)?
        .ok_or_else(invalid_credentials)?;

    if !verify_password(&request.password, &identity.password_hash) {
        return Err(invalid_credentials());
    }

    Ok(Json(issue_session(&state, identity.account).await?))
}

async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AccountResponse>, ApiError> {
    ensure_local_mode()?;
    let session = authenticate_headers(&state, &headers).await?;
    let account = state
        .accounts
        .get(session.account_id)
        .await
        .map_err(account_service_error)?
        .ok_or_else(|| ApiError::unauthorized("account is no longer available"))?;
    Ok(Json(account.into()))
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<StatusCode, ApiError> {
    ensure_local_mode()?;
    let session = authenticate_headers(&state, &headers).await?;
    state
        .auth
        .revoke_session(session.session_id)
        .await
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn introspect(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<IntrospectionResponse>, ApiError> {
    ensure_local_mode()?;
    let session = authenticate_headers(&state, &headers).await?;
    Ok(Json(IntrospectionResponse {
        account_id: session.account_id,
        session_id: session.session_id,
        expires_at: format_time(session.expires_at),
    }))
}

async fn authenticate_headers(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<AuthenticatedSession, ApiError> {
    let token = bearer_token(headers)?;
    state
        .auth
        .authenticate_token(token)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| ApiError::unauthorized("invalid or expired session"))
}

async fn issue_session(state: &AppState, account: Account) -> Result<AuthResponse, ApiError> {
    let access_token = generate_access_token().map_err(|error| {
        tracing::error!(?error, "failed to generate access token");
        ApiError::internal("failed to create session")
    })?;
    let expires_at = OffsetDateTime::now_utc() + Duration::days(SESSION_LIFETIME_DAYS);
    let token_hash = hash_access_token(&access_token);
    state
        .auth
        .create_session(account.account_id, token_hash, expires_at)
        .await
        .map_err(internal_error)?;

    Ok(AuthResponse {
        access_token,
        expires_at: format_time(expires_at),
        account: account.into(),
    })
}

async fn compensate_credential(state: &AppState, account_id: Uuid) {
    if let Err(error) = state.auth.delete_credential(account_id).await {
        tracing::error!(?error, %account_id, "failed to compensate credential creation");
    }
}

fn ensure_local_mode() -> Result<(), ApiError> {
    let environment = chat_foundation_config::optional("CHAT_ENV");
    if environment.as_deref() != Some("local") {
        return Err(ApiError::forbidden(
            "basic password authentication is available only when CHAT_ENV=local",
        ));
    }
    Ok(())
}

fn invalid_credentials() -> ApiError {
    ApiError::unauthorized("invalid username or password")
}

fn internal_error(error: anyhow::Error) -> ApiError {
    tracing::error!(?error, "authentication request failed");
    ApiError::internal("authentication request failed")
}

fn account_service_error(error: anyhow::Error) -> ApiError {
    tracing::error!(?error, "account-service request failed");
    ApiError::internal("account service unavailable")
}

impl From<Account> for AccountResponse {
    fn from(account: Account) -> Self {
        Self {
            account_id: account.account_id,
            username: account.username,
            display_name: account.display_name,
            chat_id: account.chat_id,
            avatar_data_url: account.avatar_data_url,
            created_at: format_time(account.created_at),
        }
    }
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .unwrap_or_else(|_| value.unix_timestamp().to_string())
}
