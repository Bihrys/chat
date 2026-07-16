//! Shared server foundations for the chat services.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod abuse;
pub mod account;
pub mod auth;
pub mod backup;
pub mod capability;
#[path = "contact-discovery/mod.rs"]
pub mod contact_discovery;
pub mod device;
pub mod diagnostic;
pub mod group;
#[path = "key-directory/mod.rs"]
pub mod key_directory;
#[path = "key-transparency/mod.rs"]
pub mod key_transparency;
pub mod mailbox;
pub mod object;
pub mod profile;
pub mod push;
pub mod username;

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::Body,
    http::{HeaderValue, Method, Request, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use tokio::net::TcpListener;

/// Small, serializable API error used by the development vertical slice.
///
/// The domain services keep their own error mapping, while this type gives the
/// current HTTP APIs a consistent wire shape that can survive the later switch
/// from development plaintext payloads to opaque E2EE envelopes.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    #[must_use]
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    #[must_use]
    pub fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }

    #[must_use]
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
    }

    #[must_use]
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", message)
    }

    #[must_use]
    pub fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, message)
    }

    #[must_use]
    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, message)
    }

    #[must_use]
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", message)
    }
}

#[derive(Debug, Serialize)]
struct ApiErrorBody {
    code: &'static str,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ApiErrorBody {
                code: self.code,
                message: self.message,
            }),
        )
            .into_response()
    }
}

/// Development-only permissive CORS middleware.
///
/// The Linux Tauri development shell is served by Vite on a different local
/// port than the Rust services, so browser fetches need CORS during local
/// development. Production ingress policy belongs at the deployment edge and
/// must not reuse this permissive policy.
pub async fn local_dev_cors(request: Request<Body>, next: Next) -> Response {
    let is_preflight = request.method() == Method::OPTIONS;
    let mut response = if is_preflight {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };

    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type, x-chat-account-id"),
    );
    headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );

    response
}

/// Runs an Axum router on the address configured by `address_env`.
///
/// # Errors
///
/// Returns an error when the listen address is missing, binding fails, or the
/// HTTP server exits with an error.
pub async fn serve_router(
    service_name: &'static str,
    address_env: &'static str,
    app: Router,
) -> Result<()> {
    chat_foundation_config::load_dotenv();
    chat_foundation_telemetry::init(service_name);

    let address = chat_foundation_config::required(address_env)
        .with_context(|| format!("failed to load listen address from {address_env}"))?;

    let listener = TcpListener::bind(&address)
        .await
        .with_context(|| format!("failed to bind {service_name} to {address}"))?;

    tracing::info!(service = service_name, %address, "service listening");

    axum::serve(listener, app)
        .await
        .with_context(|| format!("{service_name} server failed"))?;

    Ok(())
}

/// Runs the shared development HTTP shell for services that do not yet expose
/// a domain API.
///
/// # Errors
///
/// Returns an error when the listen address is missing, binding fails, or the
/// HTTP server exits with an error.
pub async fn run_service(service_name: &'static str, address_env: &'static str) -> Result<()> {
    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(|| async { "ready" }));

    serve_router(service_name, address_env, app).await
}
