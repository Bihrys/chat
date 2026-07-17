//! Authenticated account discovery, friend requests, and contact APIs.

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
    application::{
        validate_display_name, validate_friend_request_message, validate_internal_account,
        validate_lookup_identifier,
    },
    domain::{Account, FriendRequestMailbox, FriendRequestRecord},
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
struct LookupAccountQuery {
    identifier: String,
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

#[derive(Deserialize)]
struct UpdateAvatarRequest {
    avatar_data_url: Option<String>,
}

#[derive(Deserialize)]
struct UpdateContactRequest {
    remark_name: Option<String>,
}

#[derive(Deserialize)]
struct UpdateContactTagsRequest {
    tags: Option<String>,
}

#[derive(Deserialize)]
struct UpdateContactPermissionRequest {
    permission: String,
}

#[derive(Deserialize)]
struct UpdateContactFlagRequest {
    enabled: bool,
}

#[derive(Deserialize)]
struct CreateFriendRequest {
    recipient_account_id: Uuid,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct AccountResponse {
    account_id: Uuid,
    username: String,
    display_name: String,
    chat_id: String,
    avatar_data_url: Option<String>,
    remark_name: Option<String>,
    source: Option<String>,
    tags: Option<String>,
    friend_permission: &'static str,
    is_starred: bool,
    is_blocked: bool,
    created_at: String,
}

#[derive(Debug, Serialize)]
struct FriendRequestResponse {
    request_id: Uuid,
    sender_account_id: Uuid,
    recipient_account_id: Uuid,
    message: String,
    status: &'static str,
    created_at: String,
    updated_at: String,
    peer: AccountResponse,
}

#[derive(Debug, Serialize)]
struct FriendRequestMailboxResponse {
    incoming: Vec<FriendRequestResponse>,
    outgoing: Vec<FriendRequestResponse>,
}

#[derive(Debug, Serialize)]
struct CreateFriendRequestResponse {
    request_id: Uuid,
}

#[derive(Debug, Serialize)]
struct ContactCheckResponse {
    are_contacts: bool,
}

pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/v1/accounts", get(list_contacts))
        .route("/v1/accounts/lookup", get(lookup_account))
        .route("/v1/accounts/{account_id}", get(get_account))
        .route("/v1/contacts", get(list_contacts))
        .route(
            "/v1/contacts/{account_id}",
            get(get_contact).patch(update_contact).delete(delete_contact),
        )
        .route(
            "/v1/contacts/{account_id}/tags",
            axum::routing::patch(update_contact_tags),
        )
        .route(
            "/v1/contacts/{account_id}/permission",
            axum::routing::patch(update_contact_permission),
        )
        .route(
            "/v1/contacts/{account_id}/star",
            axum::routing::patch(update_contact_starred),
        )
        .route(
            "/v1/contacts/{account_id}/block",
            axum::routing::patch(update_contact_blocked),
        )
        .route("/v1/profile/avatar", axum::routing::patch(update_avatar))
        .route(
            "/v1/friend-requests",
            get(list_friend_requests).post(create_friend_request),
        )
        .route(
            "/v1/friend-requests/{request_id}/accept",
            post(accept_friend_request),
        )
        .route(
            "/v1/friend-requests/{request_id}/reject",
            post(reject_friend_request),
        )
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
        .route(
            "/v1/internal/contacts/{left}/{right}",
            get(check_internal_contacts),
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

async fn list_contacts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AccountResponse>>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let accounts = state
        .accounts
        .list_contacts(actor)
        .await
        .map_err(internal_error)?;
    Ok(Json(accounts.into_iter().map(Into::into).collect()))
}

async fn lookup_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<LookupAccountQuery>,
) -> Result<Json<AccountResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let identifier = validate_lookup_identifier(&query.identifier)?;
    let account = state
        .accounts
        .lookup_exact(&identifier)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    if account.account_id == actor {
        return Err(ApiError::bad_request(
            "cannot_add_self",
            "you cannot add yourself",
        ));
    }
    Ok(Json(account.into()))
}

async fn get_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
) -> Result<Json<AccountResponse>, ApiError> {
    actor_from_headers(&state, &headers).await?;
    let account = state
        .accounts
        .get(account_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn get_contact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
) -> Result<Json<AccountResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let account = state
        .accounts
        .get_contact(actor, account_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn update_contact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
    Json(request): Json<UpdateContactRequest>,
) -> Result<Json<AccountResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let remark = request
        .remark_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if remark.is_some_and(|value| value.chars().count() > 64) {
        return Err(ApiError::bad_request(
            "invalid_remark_name",
            "remark name must be at most 64 characters",
        ));
    }
    let account = state
        .accounts
        .update_contact_remark(actor, account_id, remark)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn update_contact_tags(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
    Json(request): Json<UpdateContactTagsRequest>,
) -> Result<Json<AccountResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let tags = request
        .tags
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if tags.is_some_and(|value| value.chars().count() > 256) {
        return Err(ApiError::bad_request(
            "invalid_contact_tags",
            "contact tags must be at most 256 characters",
        ));
    }
    let account = state
        .accounts
        .update_contact_tags(actor, account_id, tags)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn update_contact_permission(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
    Json(request): Json<UpdateContactPermissionRequest>,
) -> Result<Json<AccountResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let permission = match request.permission.as_str() {
        "all" => 0_i16,
        "chat_only" => 1_i16,
        _ => {
            return Err(ApiError::bad_request(
                "invalid_friend_permission",
                "permission must be all or chat_only",
            ));
        }
    };
    let account = state
        .accounts
        .update_contact_permission(actor, account_id, permission)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn update_contact_starred(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
    Json(request): Json<UpdateContactFlagRequest>,
) -> Result<Json<AccountResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let account = state
        .accounts
        .update_contact_starred(actor, account_id, request.enabled)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn update_contact_blocked(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
    Json(request): Json<UpdateContactFlagRequest>,
) -> Result<Json<AccountResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let account = state
        .accounts
        .update_contact_blocked(actor, account_id, request.enabled)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn delete_contact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    if state
        .accounts
        .delete_contact_pair(actor, account_id)
        .await
        .map_err(internal_error)?
    {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(account_not_found())
    }
}

async fn update_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<UpdateAvatarRequest>,
) -> Result<Json<AccountResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let avatar = validate_avatar_data_url(request.avatar_data_url.as_deref())?;
    let account = state
        .accounts
        .update_avatar(actor, avatar)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    Ok(Json(account.into()))
}

async fn list_friend_requests(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<FriendRequestMailboxResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let mailbox = state
        .accounts
        .list_friend_requests(actor)
        .await
        .map_err(internal_error)?;
    Ok(Json(mailbox.into()))
}

async fn create_friend_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateFriendRequest>,
) -> Result<(StatusCode, Json<CreateFriendRequestResponse>), ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    if actor == request.recipient_account_id {
        return Err(ApiError::bad_request(
            "cannot_add_self",
            "you cannot add yourself",
        ));
    }
    let actor_account = state
        .accounts
        .get(actor)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;
    state
        .accounts
        .get(request.recipient_account_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(account_not_found)?;

    if state
        .accounts
        .are_contacts(actor, request.recipient_account_id)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::conflict(
            "already_contacts",
            "this account is already in your contacts",
        ));
    }
    if state
        .accounts
        .pending_request_exists(actor, request.recipient_account_id)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::conflict(
            "friend_request_pending",
            "a friend request is already pending",
        ));
    }

    let default_message = format!("Hi, I'm {}", actor_account.display_name);
    let message =
        validate_friend_request_message(request.message.as_deref().unwrap_or(&default_message))?;
    let request_id = state
        .accounts
        .create_friend_request(actor, request.recipient_account_id, &message)
        .await
        .map_err(internal_error)?;
    Ok((
        StatusCode::CREATED,
        Json(CreateFriendRequestResponse { request_id }),
    ))
}

async fn accept_friend_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    respond_friend_request(&state, &headers, request_id, true).await
}

async fn reject_friend_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    respond_friend_request(&state, &headers, request_id, false).await
}

async fn respond_friend_request(
    state: &AppState,
    headers: &HeaderMap,
    request_id: Uuid,
    accept: bool,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(state, headers).await?;
    if !state
        .accounts
        .respond_friend_request(request_id, actor, accept)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::not_found(
            "friend_request_not_found",
            "pending friend request does not exist",
        ));
    }
    Ok(StatusCode::NO_CONTENT)
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

async fn check_internal_contacts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((left, right)): Path<(Uuid, Uuid)>,
) -> Result<Json<ContactCheckResponse>, ApiError> {
    authorize_internal(&state, &headers)?;
    let are_contacts = state
        .accounts
        .are_contacts(left, right)
        .await
        .map_err(internal_error)?;
    Ok(Json(ContactCheckResponse { are_contacts }))
}

async fn actor_from_headers(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    ensure_local_mode()?;
    Ok(state
        .sessions
        .authenticate_headers(headers)
        .await?
        .account_id)
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
            "account social APIs are available only when CHAT_ENV=local",
        ));
    }
    Ok(())
}

fn validate_avatar_data_url(value: Option<&str>) -> Result<Option<&str>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 700_000 {
        return Err(ApiError::bad_request(
            "avatar_too_large",
            "avatar must be smaller than 700 KB",
        ));
    }
    let allowed = [
        "data:image/jpeg;base64,",
        "data:image/png;base64,",
        "data:image/webp;base64,",
    ];
    if !allowed.iter().any(|prefix| value.starts_with(prefix)) {
        return Err(ApiError::bad_request(
            "invalid_avatar",
            "avatar must be a JPEG, PNG, or WebP data URL",
        ));
    }
    Ok(Some(value))
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
            chat_id: account.chat_id,
            avatar_data_url: account.avatar_data_url,
            remark_name: account.remark_name,
            source: account.source,
            tags: account.tags,
            friend_permission: if account.friend_permission == 1 { "chat_only" } else { "all" },
            is_starred: account.is_starred,
            is_blocked: account.is_blocked,
            created_at: format_time(account.created_at),
        }
    }
}

impl From<FriendRequestRecord> for FriendRequestResponse {
    fn from(request: FriendRequestRecord) -> Self {
        Self {
            request_id: request.request_id,
            sender_account_id: request.sender_account_id,
            recipient_account_id: request.recipient_account_id,
            message: request.message,
            status: request.status.as_str(),
            created_at: format_time(request.created_at),
            updated_at: format_time(request.updated_at),
            peer: request.peer.into(),
        }
    }
}

impl From<FriendRequestMailbox> for FriendRequestMailboxResponse {
    fn from(mailbox: FriendRequestMailbox) -> Self {
        Self {
            incoming: mailbox.incoming.into_iter().map(Into::into).collect(),
            outgoing: mailbox.outgoing.into_iter().map(Into::into).collect(),
        }
    }
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .unwrap_or_else(|_| value.unix_timestamp().to_string())
}
