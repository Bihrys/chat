//! Authenticated local-development direct and group chat API.

use std::{collections::HashMap, sync::Arc};

use bytes::Bytes;

use axum::{
    Json, Router,
    body::Body,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::{RwLock, broadcast};
use uuid::Uuid;

use chat_server_core::{ApiError, auth::SessionVerifier, local_dev_cors};

use crate::{
    application::{
        canonical_pair, validate_group_join_message, validate_group_lookup_identifier,
        validate_group_name, validate_initial_group_members, validate_message_body,
        validate_structured_message_body,
    },
    domain::{
        CallSignalWire, CommonGroupRecord, ConversationRecord, GroupDiscoveryRecord,
        GroupJoinRequestRecord, GroupMemberRecord, GroupRecord, GroupRole, MediaKind,
        MediaObjectRecord, MessageRecord, MessageWire, ServerEvent,
    },
    infrastructure::{ContactVerifier, MailboxRepository},
};

const DEFAULT_HISTORY_LIMIT: u16 = 100;
const MAX_HISTORY_LIMIT: u16 = 200;
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const MAX_MEDIA_BYTES: usize = 128 * 1024 * 1024;
const MAX_CALL_SIGNAL_BYTES: usize = 128 * 1024;
const MESSAGE_RECALL_WINDOW_SECONDS: i64 = 120;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) mailbox: MailboxRepository,
    pub(crate) sessions: SessionVerifier,
    pub(crate) contacts: ContactVerifier,
    pub(crate) events: EventHub,
}

#[derive(Clone, Default)]
pub(crate) struct EventHub {
    channels: Arc<RwLock<HashMap<Uuid, broadcast::Sender<ServerEvent>>>>,
}

impl EventHub {
    async fn subscribe(&self, account_id: Uuid) -> broadcast::Receiver<ServerEvent> {
        self.sender(account_id).await.subscribe()
    }

    async fn publish(&self, account_id: Uuid, event: ServerEvent) {
        let _ = self.sender(account_id).await.send(event);
    }

    async fn sender(&self, account_id: Uuid) -> broadcast::Sender<ServerEvent> {
        if let Some(sender) = self.channels.read().await.get(&account_id).cloned() {
            return sender;
        }
        let mut channels = self.channels.write().await;
        channels
            .entry(account_id)
            .or_insert_with(|| broadcast::channel(256).0)
            .clone()
    }
}

#[derive(Debug, Deserialize)]
struct CreateDirectConversationRequest {
    peer_account_id: Uuid,
}

#[derive(Debug, Deserialize)]
struct CreateMessageRequest {
    client_message_id: Uuid,
    #[serde(default = "default_payload_format")]
    payload_format: String,
    body: String,
}

#[derive(Debug, Deserialize)]
struct MediaUploadQuery {
    kind: String,
    file_name: String,
}

#[derive(Debug, Serialize)]
struct MediaObjectResponse {
    object_id: Uuid,
    conversation_id: Uuid,
    owner_account_id: Uuid,
    media_kind: &'static str,
    file_name: String,
    content_type: String,
    byte_len: i64,
    created_at: String,
}

#[derive(Debug, Deserialize)]
struct MediaMessageMetadata {
    object_id: Uuid,
    media_kind: String,
    file_name: String,
    content_type: String,
    byte_len: i64,
    duration_ms: Option<i64>,
    width: Option<i64>,
    height: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct SendCallSignalRequest {
    call_id: Uuid,
    conversation_id: Uuid,
    to_account_id: Uuid,
    media: String,
    signal_type: String,
    #[serde(default)]
    payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct MessageHistoryQuery {
    before_seq: Option<i64>,
    limit: Option<u16>,
}

#[derive(Debug, Deserialize)]
struct MessageSearchQuery {
    q: String,
    limit: Option<u16>,
}

#[derive(Debug, Deserialize)]
struct UpdateConversationPreferencesRequest {
    is_pinned: bool,
    is_muted: bool,
}

#[derive(Debug, Deserialize, Default)]
struct ClearConversationHistoryQuery {
    #[serde(default)]
    hide: bool,
}

#[derive(Debug, Deserialize)]
struct WebSocketQuery {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct CreateGroupRequest {
    name: String,
    #[serde(default)]
    member_account_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
struct GroupLookupQuery {
    identifier: String,
}

#[derive(Debug, Deserialize)]
struct CreateGroupJoinRequest {
    message: String,
}

#[derive(Debug, Deserialize)]
struct AddGroupMemberRequest {
    account_id: Uuid,
}

#[derive(Debug, Deserialize)]
struct SetGroupRoleRequest {
    role: String,
}

#[derive(Clone, Debug, Serialize)]
struct ConversationResponse {
    conversation_id: Uuid,
    kind: &'static str,
    peer_account_id: Option<Uuid>,
    group_id: Option<Uuid>,
    group_code: Option<String>,
    group_name: Option<String>,
    group_role: Option<&'static str>,
    member_count: Option<i64>,
    created_at: String,
    last_message_at: Option<String>,
    unread_count: i64,
    is_pinned: bool,
    is_muted: bool,
    last_message: Option<MessageWire>,
}

#[derive(Debug, Serialize)]
struct GroupDiscoveryResponse {
    group_id: Uuid,
    conversation_id: Uuid,
    group_code: String,
    name: String,
    member_count: i64,
    actor_role: Option<&'static str>,
    join_request_status: Option<&'static str>,
}

#[derive(Debug, Serialize)]
struct GroupJoinRequestResponse {
    request_id: Uuid,
    group_id: Uuid,
    applicant_account_id: Uuid,
    message: String,
    status: &'static str,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct CreateGroupJoinRequestResponse {
    request_id: Uuid,
}

#[derive(Debug, Serialize)]
struct GroupMemberResponse {
    account_id: Uuid,
    role: &'static str,
    joined_at: String,
}

#[derive(Debug, Serialize)]
struct GroupResponse {
    group_id: Uuid,
    conversation_id: Uuid,
    group_code: String,
    name: String,
    owner_account_id: Uuid,
    actor_role: &'static str,
    created_at: String,
    members: Vec<GroupMemberResponse>,
}

#[derive(Debug, Serialize)]
struct MarkReadResponse {
    conversation_id: Uuid,
    last_read_seq: i64,
}

#[derive(Debug, Serialize)]
struct CommonGroupResponse {
    group_id: Uuid,
    conversation_id: Uuid,
    group_code: String,
    name: String,
}

pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/v1/conversations", get(list_conversations))
        .route("/v1/conversations/direct", post(create_direct_conversation))
        .route(
            "/v1/contacts/{account_id}/common-groups",
            get(list_common_groups),
        )
        .route(
            "/v1/conversations/{conversation_id}/messages",
            get(list_messages).post(create_message),
        )
        .route(
            "/v1/conversations/{conversation_id}/messages/search",
            get(search_messages),
        )
        .route(
            "/v1/conversations/{conversation_id}/messages/{message_id}/recall",
            post(recall_message),
        )
        .route(
            "/v1/conversations/{conversation_id}/preferences",
            axum::routing::patch(update_conversation_preferences),
        )
        .route(
            "/v1/conversations/{conversation_id}/history",
            delete(clear_conversation_history),
        )
        .route("/v1/conversations/{conversation_id}/read", post(mark_read))
        .route("/v1/groups", post(create_group))
        .route("/v1/groups/lookup", get(lookup_group))
        .route(
            "/v1/groups/{group_id}",
            get(get_group).delete(dissolve_group),
        )
        .route(
            "/v1/groups/{group_id}/join-requests",
            get(list_group_join_requests).post(create_group_join_request),
        )
        .route(
            "/v1/groups/{group_id}/join-requests/{request_id}/accept",
            post(accept_group_join_request),
        )
        .route(
            "/v1/groups/{group_id}/join-requests/{request_id}/reject",
            post(reject_group_join_request),
        )
        .route("/v1/groups/{group_id}/members", post(add_group_member))
        .route(
            "/v1/groups/{group_id}/members/{account_id}",
            delete(remove_group_member),
        )
        .route(
            "/v1/groups/{group_id}/members/{account_id}/role",
            post(set_group_member_role),
        )
        .route(
            "/v1/conversations/{conversation_id}/media",
            post(upload_media),
        )
        .route("/v1/media/{object_id}", get(download_media))
        .route("/v1/calls/signals", post(send_call_signal))
        .route("/v1/ws", get(websocket_upgrade))
        .with_state(state)
        .layer(DefaultBodyLimit::max(MAX_MEDIA_BYTES))
        .layer(middleware::from_fn(local_dev_cors))
}

async fn healthz() -> &'static str {
    "ok"
}

async fn readyz(State(state): State<AppState>) -> Result<&'static str, ApiError> {
    state.mailbox.healthcheck().await.map_err(|error| {
        tracing::error!(?error, "mailbox database readiness check failed");
        ApiError::internal("mailbox database unavailable")
    })?;
    state.sessions.healthcheck().await.map_err(|error| {
        tracing::error!(?error, "mailbox authentication readiness check failed");
        ApiError::internal("authentication service unavailable")
    })?;
    Ok("ready")
}

async fn list_conversations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ConversationResponse>>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let conversations = state
        .mailbox
        .list_conversations(actor)
        .await
        .map_err(internal_error)?;
    let mut visible = Vec::with_capacity(conversations.len());
    for conversation in conversations {
        if let Some(peer) = conversation.peer_account_id
            && !state
                .contacts
                .are_contacts(actor, peer)
                .await
                .map_err(internal_error)?
        {
            continue;
        }
        visible.push(ConversationResponse::from(conversation));
    }
    Ok(Json(visible))
}

async fn list_common_groups(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(account_id): Path<Uuid>,
) -> Result<Json<Vec<CommonGroupResponse>>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_contacts(&state, actor, account_id).await?;
    let groups = state
        .mailbox
        .list_common_groups(actor, account_id)
        .await
        .map_err(internal_error)?;
    Ok(Json(groups.into_iter().map(Into::into).collect()))
}

async fn create_direct_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateDirectConversationRequest>,
) -> Result<(StatusCode, Json<ConversationResponse>), ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    canonical_pair(actor, request.peer_account_id)?;
    ensure_contacts(&state, actor, request.peer_account_id).await?;
    let conversation = state
        .mailbox
        .create_direct_conversation(actor, request.peer_account_id)
        .await
        .map_err(internal_error)?;
    Ok((StatusCode::CREATED, Json(conversation.into())))
}

async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
    Query(query): Query<MessageHistoryQuery>,
) -> Result<Json<Vec<MessageWire>>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_member(&state, conversation_id, actor).await?;
    let limit = i64::from(
        query
            .limit
            .unwrap_or(DEFAULT_HISTORY_LIMIT)
            .clamp(1, MAX_HISTORY_LIMIT),
    );
    let messages = state
        .mailbox
        .list_messages(conversation_id, actor, query.before_seq, limit)
        .await
        .map_err(internal_error)?;
    Ok(Json(messages.into_iter().map(message_to_wire).collect()))
}

async fn search_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
    Query(query): Query<MessageSearchQuery>,
) -> Result<Json<Vec<MessageWire>>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_member(&state, conversation_id, actor).await?;
    let term = query.q.trim();
    if term.is_empty() {
        return Ok(Json(Vec::new()));
    }
    if term.chars().count() > 200 {
        return Err(ApiError::bad_request(
            "message_search_too_long",
            "message search must be at most 200 characters",
        ));
    }
    let limit = i64::from(
        query
            .limit
            .unwrap_or(DEFAULT_HISTORY_LIMIT)
            .clamp(1, MAX_HISTORY_LIMIT),
    );
    let messages = state
        .mailbox
        .search_messages(conversation_id, actor, term, limit)
        .await
        .map_err(internal_error)?;
    Ok(Json(messages.into_iter().map(message_to_wire).collect()))
}

async fn create_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
    Json(request): Json<CreateMessageRequest>,
) -> Result<(StatusCode, Json<MessageWire>), ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_member(&state, conversation_id, actor).await?;
    if let Some(peer) = state
        .mailbox
        .direct_peer(conversation_id, actor)
        .await
        .map_err(internal_error)?
    {
        ensure_contacts(&state, actor, peer).await?;
    }
    let (payload_format, body) = match request.payload_format.as_str() {
        "plaintext_dev_v0" => (0_i16, validate_message_body(&request.body)?),
        "media_v0" | "sticker_v0" => {
            let body = validate_structured_message_body(&request.body)?;
            let metadata = parse_media_message_metadata(&body)?;
            let media = state
                .mailbox
                .get_media_object(metadata.object_id)
                .await
                .map_err(internal_error)?
                .ok_or_else(|| {
                    ApiError::not_found("media_not_found", "media object does not exist")
                })?;
            if media.conversation_id != conversation_id || media.owner_account_id != actor {
                return Err(ApiError::forbidden(
                    "media object does not belong to this sender and conversation",
                ));
            }
            validate_media_message_metadata(&metadata, &media)?;
            let expected_format = if request.payload_format == "sticker_v0" {
                2_i16
            } else {
                1_i16
            };
            if expected_format == 2 && media.media_kind != MediaKind::Sticker {
                return Err(ApiError::bad_request(
                    "invalid_sticker",
                    "sticker message must reference a sticker object",
                ));
            }
            if expected_format == 1 && media.media_kind == MediaKind::Sticker {
                return Err(ApiError::bad_request(
                    "invalid_media_message",
                    "sticker objects must use sticker_v0",
                ));
            }
            (expected_format, body)
        }
        _ => {
            return Err(ApiError::bad_request(
                "unsupported_payload_format",
                "unsupported message payload format",
            ));
        }
    };
    let message = state
        .mailbox
        .insert_message(
            conversation_id,
            actor,
            request.client_message_id,
            payload_format,
            &body,
        )
        .await
        .map_err(internal_error)?;
    let message_wire = message_to_wire(message);
    let members = state
        .mailbox
        .conversation_members(conversation_id)
        .await
        .map_err(internal_error)?;
    let event = ServerEvent::MessageCreated {
        message: message_wire.clone(),
    };
    for member in members {
        state.events.publish(member, event.clone()).await;
    }
    Ok((StatusCode::CREATED, Json(message_wire)))
}

async fn recall_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((conversation_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<MessageWire>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_member(&state, conversation_id, actor).await?;

    let existing = state
        .mailbox
        .get_message(conversation_id, message_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| ApiError::not_found("message_not_found", "message does not exist"))?;

    if existing.sender_account_id != actor {
        return Err(ApiError::forbidden("only the sender can recall a message"));
    }
    if existing.payload_format == 3 {
        return Err(ApiError::conflict(
            "message_already_recalled",
            "message has already been recalled",
        ));
    }
    if OffsetDateTime::now_utc() - existing.created_at
        > Duration::seconds(MESSAGE_RECALL_WINDOW_SECONDS)
    {
        return Err(ApiError::conflict(
            "message_recall_expired",
            "messages can only be recalled within two minutes",
        ));
    }

    let recalled = state
        .mailbox
        .recall_message(conversation_id, message_id, actor)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| {
            ApiError::conflict("message_recall_failed", "message could not be recalled")
        })?;

    let message_wire = message_to_wire(recalled);
    let event = ServerEvent::MessageRecalled {
        message: message_wire.clone(),
    };
    let members = state
        .mailbox
        .conversation_members(conversation_id)
        .await
        .map_err(internal_error)?;
    for member in members {
        state.events.publish(member, event.clone()).await;
    }

    Ok(Json(message_wire))
}

async fn update_conversation_preferences(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
    Json(request): Json<UpdateConversationPreferencesRequest>,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_member(&state, conversation_id, actor).await?;
    state
        .mailbox
        .update_conversation_preferences(
            conversation_id,
            actor,
            request.is_pinned,
            request.is_muted,
        )
        .await
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn clear_conversation_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
    Query(query): Query<ClearConversationHistoryQuery>,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_member(&state, conversation_id, actor).await?;
    state
        .mailbox
        .clear_conversation_history(conversation_id, actor, query.hide)
        .await
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn mark_read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
) -> Result<Json<MarkReadResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_member(&state, conversation_id, actor).await?;
    let last_read_seq = state
        .mailbox
        .mark_read(conversation_id, actor)
        .await
        .map_err(internal_error)?;
    let members = state
        .mailbox
        .conversation_members(conversation_id)
        .await
        .map_err(internal_error)?;
    let event = ServerEvent::ConversationRead {
        conversation_id,
        account_id: actor,
        last_read_seq,
    };
    for member in members {
        state.events.publish(member, event.clone()).await;
    }
    Ok(Json(MarkReadResponse {
        conversation_id,
        last_read_seq,
    }))
}

async fn create_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateGroupRequest>,
) -> Result<(StatusCode, Json<GroupResponse>), ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let name = validate_group_name(&request.name)?;
    validate_initial_group_members(&request.member_account_ids)?;
    for member in &request.member_account_ids {
        if *member != actor {
            ensure_contacts(&state, actor, *member).await?;
        }
    }
    let group = state
        .mailbox
        .create_group(actor, &name, &request.member_account_ids)
        .await
        .map_err(internal_error)?;
    let event = ServerEvent::GroupUpdated {
        group_id: group.group_id,
    };
    for member in &group.members {
        state.events.publish(member.account_id, event.clone()).await;
    }
    Ok((StatusCode::CREATED, Json(group.into())))
}

async fn lookup_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GroupLookupQuery>,
) -> Result<Json<GroupDiscoveryResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let identifier = validate_group_lookup_identifier(&query.identifier)?;
    let group = state
        .mailbox
        .lookup_group(&identifier, actor)
        .await
        .map_err(internal_error)?
        .ok_or_else(group_not_found)?;
    Ok(Json(group.into()))
}

async fn create_group_join_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<Uuid>,
    Json(request): Json<CreateGroupJoinRequest>,
) -> Result<(StatusCode, Json<CreateGroupJoinRequestResponse>), ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let message = validate_group_join_message(&request.message)?;
    let request = state
        .mailbox
        .create_group_join_request(group_id, actor, &message)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| {
            ApiError::conflict(
                "group_join_request_not_created",
                "you are already a member or already have a pending request",
            )
        })?;
    publish_group_update(&state, group_id, actor, None).await?;
    Ok((
        StatusCode::CREATED,
        Json(CreateGroupJoinRequestResponse {
            request_id: request.request_id,
        }),
    ))
}

async fn list_group_join_requests(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<Uuid>,
) -> Result<Json<Vec<GroupJoinRequestResponse>>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let requests = state
        .mailbox
        .list_group_join_requests(group_id, actor)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| {
            ApiError::forbidden("only group owners and administrators can review join requests")
        })?;
    Ok(Json(requests.into_iter().map(Into::into).collect()))
}

async fn accept_group_join_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((group_id, request_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    respond_group_join_request(&state, &headers, group_id, request_id, true).await
}

async fn reject_group_join_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((group_id, request_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    respond_group_join_request(&state, &headers, group_id, request_id, false).await
}

async fn respond_group_join_request(
    state: &AppState,
    headers: &HeaderMap,
    group_id: Uuid,
    request_id: Uuid,
    accepted: bool,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(state, headers).await?;
    let applicant = state
        .mailbox
        .respond_group_join_request(group_id, request_id, actor, accepted)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| {
            ApiError::forbidden("group join request is missing or you are not allowed to decide it")
        })?;
    publish_group_update(state, group_id, actor, Some(applicant)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<Uuid>,
) -> Result<Json<GroupResponse>, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let group = state
        .mailbox
        .get_group(group_id, actor)
        .await
        .map_err(internal_error)?
        .ok_or_else(group_not_found)?;
    Ok(Json(group.into()))
}

async fn add_group_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<Uuid>,
    Json(request): Json<AddGroupMemberRequest>,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_contacts(&state, actor, request.account_id).await?;
    if !state
        .mailbox
        .add_group_member(group_id, actor, request.account_id)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::conflict(
            "group_member_not_added",
            "group does not exist or account is already a member",
        ));
    }
    publish_group_update(&state, group_id, actor, Some(request.account_id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_group_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((group_id, account_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    if !state
        .mailbox
        .remove_group_member(group_id, actor, account_id)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::forbidden(
            "you are not allowed to remove this group member",
        ));
    }
    publish_group_update(&state, group_id, actor, Some(account_id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn set_group_member_role(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((group_id, account_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<SetGroupRoleRequest>,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let role = match request.role.as_str() {
        "admin" => GroupRole::Admin,
        "member" => GroupRole::Member,
        _ => {
            return Err(ApiError::bad_request(
                "invalid_group_role",
                "role must be admin or member",
            ));
        }
    };
    if !state
        .mailbox
        .set_group_member_role(group_id, actor, account_id, role)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::forbidden(
            "only the group owner can change administrator roles",
        ));
    }
    publish_group_update(&state, group_id, actor, None).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn dissolve_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let members = state
        .mailbox
        .get_group(group_id, actor)
        .await
        .map_err(internal_error)?
        .ok_or_else(group_not_found)?
        .members;
    if !state
        .mailbox
        .dissolve_group(group_id, actor)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::forbidden(
            "only the group owner can dissolve the group",
        ));
    }
    let event = ServerEvent::GroupUpdated { group_id };
    for member in members {
        state.events.publish(member.account_id, event.clone()).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn publish_group_update(
    state: &AppState,
    group_id: Uuid,
    _actor: Uuid,
    extra_account: Option<Uuid>,
) -> Result<(), ApiError> {
    let members = state
        .mailbox
        .group_member_ids(group_id)
        .await
        .map_err(internal_error)?;
    let event = ServerEvent::GroupUpdated { group_id };
    for account_id in members {
        state.events.publish(account_id, event.clone()).await;
    }
    if let Some(account_id) = extra_account {
        state.events.publish(account_id, event).await;
    }
    Ok(())
}

async fn upload_media(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
    Query(query): Query<MediaUploadQuery>,
    body: Bytes,
) -> Result<(StatusCode, Json<MediaObjectResponse>), ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_member(&state, conversation_id, actor).await?;
    if body.is_empty() {
        return Err(ApiError::bad_request(
            "empty_media",
            "media upload cannot be empty",
        ));
    }
    if body.len() > MAX_MEDIA_BYTES {
        return Err(ApiError::bad_request(
            "media_too_large",
            "media upload exceeds 128 MiB",
        ));
    }
    let media_kind = parse_media_kind(&query.kind)?;
    if matches!(media_kind, MediaKind::Image | MediaKind::Sticker) && body.len() > MAX_IMAGE_BYTES {
        return Err(ApiError::bad_request(
            "media_too_large",
            "image and sticker uploads exceed 25 MiB",
        ));
    }
    let file_name = sanitize_file_name(&query.file_name)?;
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .trim();
    validate_media_content_type(media_kind, content_type)?;
    let object = state
        .mailbox
        .create_media_object(
            conversation_id,
            actor,
            media_kind,
            &file_name,
            content_type,
            body,
        )
        .await
        .map_err(internal_error)?;
    Ok((StatusCode::CREATED, Json(object.into())))
}

async fn download_media(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(object_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    let object = state
        .mailbox
        .get_media_object(object_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| ApiError::not_found("media_not_found", "media object does not exist"))?;
    ensure_member(&state, object.conversation_id, actor).await?;
    let bytes = state
        .mailbox
        .read_media_bytes(&object)
        .await
        .map_err(internal_error)?;
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    if let Ok(value) = HeaderValue::from_str(&object.content_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    if let Ok(value) = HeaderValue::from_str(&object.byte_len.to_string()) {
        response.headers_mut().insert(header::CONTENT_LENGTH, value);
    }
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=3600"),
    );
    Ok(response.into_response())
}

async fn send_call_signal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SendCallSignalRequest>,
) -> Result<StatusCode, ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    ensure_member(&state, request.conversation_id, actor).await?;
    let peer = state
        .mailbox
        .direct_peer(request.conversation_id, actor)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| {
            ApiError::bad_request(
                "direct_call_only",
                "calls are currently supported only in direct chats",
            )
        })?;
    if peer != request.to_account_id {
        return Err(ApiError::forbidden(
            "call target is not the direct-chat peer",
        ));
    }
    ensure_contacts(&state, actor, peer).await?;
    if !matches!(request.media.as_str(), "audio" | "video") {
        return Err(ApiError::bad_request(
            "invalid_call_media",
            "call media must be audio or video",
        ));
    }
    if !matches!(
        request.signal_type.as_str(),
        "offer" | "answer" | "ice" | "hangup" | "reject" | "busy"
    ) {
        return Err(ApiError::bad_request(
            "invalid_call_signal",
            "unsupported call signal type",
        ));
    }
    if serde_json::to_vec(&request.payload)
        .map_err(|_| {
            ApiError::bad_request("invalid_call_payload", "call payload is not serializable")
        })?
        .len()
        > MAX_CALL_SIGNAL_BYTES
    {
        return Err(ApiError::bad_request(
            "call_payload_too_large",
            "call signal payload is too large",
        ));
    }
    state
        .events
        .publish(
            peer,
            ServerEvent::CallSignal {
                signal: CallSignalWire {
                    call_id: request.call_id,
                    conversation_id: request.conversation_id,
                    from_account_id: actor,
                    to_account_id: peer,
                    media: request.media,
                    signal_type: request.signal_type,
                    payload: request.payload,
                },
            },
        )
        .await;
    Ok(StatusCode::NO_CONTENT)
}

async fn websocket_upgrade(
    State(state): State<AppState>,
    Query(query): Query<WebSocketQuery>,
    websocket: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    ensure_local_mode()?;
    let session = state
        .sessions
        .authenticate_token(&query.access_token)
        .await?;
    let account_id = session.account_id;
    Ok(websocket.on_upgrade(move |socket| websocket_session(socket, state, account_id)))
}

async fn websocket_session(socket: WebSocket, state: AppState, account_id: Uuid) {
    let (mut sender, mut receiver) = socket.split();
    let mut events = state.events.subscribe(account_id).await;
    let connected = ServerEvent::Connected { account_id };
    if !send_event(&mut sender, &connected).await {
        return;
    }
    loop {
        tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(error)) => {
                        tracing::debug!(%account_id, ?error, "websocket receive failed");
                        break;
                    }
                    Some(Ok(_)) => {}
                }
            }
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        if !send_event(&mut sender, &event).await {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(%account_id, skipped, "websocket receiver lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn send_event<S>(sender: &mut S, event: &ServerEvent) -> bool
where
    S: futures_util::Sink<Message> + Unpin,
{
    let Ok(serialized) = serde_json::to_string(event) else {
        tracing::error!("failed to serialize websocket event");
        return false;
    };
    sender.send(Message::Text(serialized.into())).await.is_ok()
}

async fn ensure_contacts(state: &AppState, left: Uuid, right: Uuid) -> Result<(), ApiError> {
    if !state
        .contacts
        .are_contacts(left, right)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::forbidden(
            "add this account as a contact before starting or inviting to a chat",
        ));
    }
    Ok(())
}

async fn ensure_member(
    state: &AppState,
    conversation_id: Uuid,
    actor: Uuid,
) -> Result<(), ApiError> {
    if !state
        .mailbox
        .ensure_member(conversation_id, actor)
        .await
        .map_err(internal_error)?
    {
        return Err(ApiError::not_found(
            "conversation_not_found",
            "conversation does not exist",
        ));
    }
    Ok(())
}

async fn actor_from_headers(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    ensure_local_mode()?;
    Ok(state
        .sessions
        .authenticate_headers(headers)
        .await?
        .account_id)
}

fn ensure_local_mode() -> Result<(), ApiError> {
    let environment = chat_foundation_config::optional("CHAT_ENV");
    if environment.as_deref() != Some("local") {
        return Err(ApiError::forbidden(
            "development chat API is available only when CHAT_ENV=local",
        ));
    }
    Ok(())
}

fn group_not_found() -> ApiError {
    ApiError::not_found("group_not_found", "group does not exist")
}

fn internal_error(error: anyhow::Error) -> ApiError {
    tracing::error!(?error, "mailbox request failed");
    ApiError::internal("mailbox request failed")
}

impl From<CommonGroupRecord> for CommonGroupResponse {
    fn from(group: CommonGroupRecord) -> Self {
        Self {
            group_id: group.group_id,
            conversation_id: group.conversation_id,
            group_code: group.group_code,
            name: group.name,
        }
    }
}

impl From<ConversationRecord> for ConversationResponse {
    fn from(conversation: ConversationRecord) -> Self {
        Self {
            conversation_id: conversation.conversation_id,
            kind: conversation.kind.as_str(),
            peer_account_id: conversation.peer_account_id,
            group_id: conversation.group_id,
            group_code: conversation.group_code,
            group_name: conversation.group_name,
            group_role: conversation.group_role.map(GroupRole::as_str),
            member_count: conversation.member_count,
            created_at: format_time(conversation.created_at),
            last_message_at: conversation.last_message_at.map(format_time),
            unread_count: conversation.unread_count,
            is_pinned: conversation.is_pinned,
            is_muted: conversation.is_muted,
            last_message: conversation.last_message.map(message_to_wire),
        }
    }
}

impl From<GroupDiscoveryRecord> for GroupDiscoveryResponse {
    fn from(group: GroupDiscoveryRecord) -> Self {
        Self {
            group_id: group.group_id,
            conversation_id: group.conversation_id,
            group_code: group.group_code,
            name: group.name,
            member_count: group.member_count,
            actor_role: group.actor_role.map(GroupRole::as_str),
            join_request_status: group.join_request_status.map(|status| status.as_str()),
        }
    }
}

impl From<GroupJoinRequestRecord> for GroupJoinRequestResponse {
    fn from(request: GroupJoinRequestRecord) -> Self {
        Self {
            request_id: request.request_id,
            group_id: request.group_id,
            applicant_account_id: request.applicant_account_id,
            message: request.message,
            status: request.status.as_str(),
            created_at: format_time(request.created_at),
            updated_at: format_time(request.updated_at),
        }
    }
}

impl From<GroupMemberRecord> for GroupMemberResponse {
    fn from(member: GroupMemberRecord) -> Self {
        Self {
            account_id: member.account_id,
            role: member.role.as_str(),
            joined_at: format_time(member.joined_at),
        }
    }
}

impl From<GroupRecord> for GroupResponse {
    fn from(group: GroupRecord) -> Self {
        Self {
            group_id: group.group_id,
            conversation_id: group.conversation_id,
            group_code: group.group_code,
            name: group.name,
            owner_account_id: group.owner_account_id,
            actor_role: group.actor_role.as_str(),
            created_at: format_time(group.created_at),
            members: group.members.into_iter().map(Into::into).collect(),
        }
    }
}

fn message_to_wire(message: MessageRecord) -> MessageWire {
    MessageWire {
        message_seq: message.message_seq,
        message_id: message.message_id,
        conversation_id: message.conversation_id,
        sender_account_id: message.sender_account_id,
        client_message_id: message.client_message_id,
        payload_format: payload_format_name(message.payload_format),
        body: message.body,
        created_at: format_time(message.created_at),
    }
}

fn payload_format_name(payload_format: i16) -> &'static str {
    match payload_format {
        0 => "plaintext_dev_v0",
        1 => "media_v0",
        2 => "sticker_v0",
        3 => "recalled_v0",
        _ => "unknown",
    }
}

fn default_payload_format() -> String {
    "plaintext_dev_v0".to_owned()
}

fn parse_media_kind(value: &str) -> Result<MediaKind, ApiError> {
    match value {
        "image" => Ok(MediaKind::Image),
        "video" => Ok(MediaKind::Video),
        "voice" => Ok(MediaKind::Voice),
        "sticker" => Ok(MediaKind::Sticker),
        "file" => Ok(MediaKind::File),
        _ => Err(ApiError::bad_request(
            "invalid_media_kind",
            "unsupported media kind",
        )),
    }
}

fn sanitize_file_name(value: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 180 {
        return Err(ApiError::bad_request(
            "invalid_file_name",
            "file name must contain 1-180 characters",
        ));
    }
    let name = value
        .chars()
        .map(|character| match character {
            '/' | '\\' | '\0' | '\r' | '\n' => '_',
            _ => character,
        })
        .collect::<String>();
    Ok(name)
}

fn validate_media_content_type(kind: MediaKind, content_type: &str) -> Result<(), ApiError> {
    let valid = match kind {
        MediaKind::Image | MediaKind::Sticker => content_type.starts_with("image/"),
        MediaKind::Video => content_type.starts_with("video/"),
        MediaKind::Voice => content_type.starts_with("audio/"),
        MediaKind::File => !content_type.is_empty(),
    };
    if valid {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "invalid_media_type",
            "content type does not match media kind",
        ))
    }
}

fn parse_media_message_metadata(body: &str) -> Result<MediaMessageMetadata, ApiError> {
    let metadata: MediaMessageMetadata = serde_json::from_str(body).map_err(|_| {
        ApiError::bad_request("invalid_media_message", "media message metadata is invalid")
    })?;
    if metadata
        .duration_ms
        .is_some_and(|value| !(1..=86_400_000).contains(&value))
    {
        return Err(ApiError::bad_request(
            "invalid_media_duration",
            "media duration is outside the supported range",
        ));
    }
    if metadata
        .width
        .is_some_and(|value| !(1..=32_768).contains(&value))
        || metadata
            .height
            .is_some_and(|value| !(1..=32_768).contains(&value))
    {
        return Err(ApiError::bad_request(
            "invalid_media_dimensions",
            "media dimensions are outside the supported range",
        ));
    }
    Ok(metadata)
}

fn validate_media_message_metadata(
    metadata: &MediaMessageMetadata,
    object: &MediaObjectRecord,
) -> Result<(), ApiError> {
    if metadata.media_kind != object.media_kind.as_str()
        || metadata.file_name != object.file_name
        || metadata.content_type != object.content_type
        || metadata.byte_len != object.byte_len
    {
        return Err(ApiError::bad_request(
            "media_metadata_mismatch",
            "media message metadata does not match the uploaded object",
        ));
    }
    Ok(())
}

impl From<MediaObjectRecord> for MediaObjectResponse {
    fn from(object: MediaObjectRecord) -> Self {
        Self {
            object_id: object.object_id,
            conversation_id: object.conversation_id,
            owner_account_id: object.owner_account_id,
            media_kind: object.media_kind.as_str(),
            file_name: object.file_name,
            content_type: object.content_type,
            byte_len: object.byte_len,
            created_at: format_time(object.created_at),
        }
    }
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .unwrap_or_else(|_| value.unix_timestamp().to_string())
}
