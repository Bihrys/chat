//! Public development API for the first complete one-to-one chat loop.
//!
//! This API is intentionally available only in `CHAT_ENV=local`. Requests are
//! authenticated with opaque bearer sessions issued by `auth-service`. Message
//! payloads are still plaintext in this development phase; the authentication
//! boundary can remain when the payload is replaced by an E2EE envelope.

use std::{collections::HashMap, sync::Arc};

use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    middleware,
    response::Response,
    routing::{get, post},
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::{RwLock, broadcast};
use uuid::Uuid;

use chat_server_core::{ApiError, auth::SessionVerifier, local_dev_cors};

use crate::{
    application::{canonical_pair, validate_message_body},
    domain::{ConversationRecord, MessageRecord, MessageWire, ServerEvent},
    infrastructure::MailboxRepository,
};

const DEFAULT_HISTORY_LIMIT: u16 = 100;
const MAX_HISTORY_LIMIT: u16 = 200;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) mailbox: MailboxRepository,
    pub(crate) sessions: SessionVerifier,
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
    body: String,
}

#[derive(Debug, Deserialize)]
struct MessageHistoryQuery {
    before_seq: Option<i64>,
    limit: Option<u16>,
}

#[derive(Debug, Deserialize)]
struct WebSocketQuery {
    access_token: String,
}

#[derive(Clone, Debug, Serialize)]
struct ConversationResponse {
    conversation_id: Uuid,
    peer_account_id: Uuid,
    created_at: String,
    last_message_at: Option<String>,
    unread_count: i64,
    last_message: Option<MessageWire>,
}

#[derive(Debug, Serialize)]
struct MarkReadResponse {
    conversation_id: Uuid,
    last_read_seq: i64,
}

pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/v1/conversations", get(list_conversations))
        .route("/v1/conversations/direct", post(create_direct_conversation))
        .route(
            "/v1/conversations/{conversation_id}/messages",
            get(list_messages).post(create_message),
        )
        .route("/v1/conversations/{conversation_id}/read", post(mark_read))
        .route("/v1/ws", get(websocket_upgrade))
        .with_state(state)
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
        ApiError::internal("authentication database unavailable")
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

    Ok(Json(
        conversations
            .into_iter()
            .map(ConversationResponse::from)
            .collect(),
    ))
}

async fn create_direct_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateDirectConversationRequest>,
) -> Result<(StatusCode, Json<ConversationResponse>), ApiError> {
    let actor = actor_from_headers(&state, &headers).await?;
    canonical_pair(actor, request.peer_account_id)?;

    let conversation = state
        .mailbox
        .create_direct_conversation(actor, request.peer_account_id)
        .await
        .map_err(internal_error)?;

    Ok((
        StatusCode::CREATED,
        Json(ConversationResponse::from(conversation)),
    ))
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
        .list_messages(conversation_id, query.before_seq, limit)
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
    let body = validate_message_body(&request.body)?;

    let message = state
        .mailbox
        .insert_message(conversation_id, actor, request.client_message_id, &body)
        .await
        .map_err(internal_error)?;
    let message_wire = message_to_wire(message);

    let members = state
        .mailbox
        .conversation_members(conversation_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(|| {
            ApiError::not_found("conversation_not_found", "conversation does not exist")
        })?;

    let event = ServerEvent::MessageCreated {
        message: message_wire.clone(),
    };
    state.events.publish(members.0, event.clone()).await;
    state.events.publish(members.1, event).await;

    Ok((StatusCode::CREATED, Json(message_wire)))
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

    if let Some(members) = state
        .mailbox
        .conversation_members(conversation_id)
        .await
        .map_err(internal_error)?
    {
        let event = ServerEvent::ConversationRead {
            conversation_id,
            account_id: actor,
            last_read_seq,
        };
        state.events.publish(members.0, event.clone()).await;
        state.events.publish(members.1, event).await;
    }

    Ok(Json(MarkReadResponse {
        conversation_id,
        last_read_seq,
    }))
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
                        tracing::warn!(%account_id, skipped, "websocket event receiver lagged; client should refresh state");
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

async fn ensure_member(
    state: &AppState,
    conversation_id: Uuid,
    actor: Uuid,
) -> Result<(), ApiError> {
    let is_member = state
        .mailbox
        .ensure_member(conversation_id, actor)
        .await
        .map_err(internal_error)?;

    if !is_member {
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
            "development plaintext chat API is available only when CHAT_ENV=local",
        ));
    }
    Ok(())
}

fn internal_error(error: anyhow::Error) -> ApiError {
    tracing::error!(?error, "mailbox request failed");
    ApiError::internal("mailbox request failed")
}

impl From<ConversationRecord> for ConversationResponse {
    fn from(conversation: ConversationRecord) -> Self {
        Self {
            conversation_id: conversation.conversation_id,
            peer_account_id: conversation.peer_account_id,
            created_at: format_time(conversation.created_at),
            last_message_at: conversation.last_message_at.map(format_time),
            unread_count: conversation.unread_count,
            last_message: conversation.last_message.map(message_to_wire),
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
        _ => "unknown",
    }
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .unwrap_or_else(|_| value.unix_timestamp().to_string())
}
