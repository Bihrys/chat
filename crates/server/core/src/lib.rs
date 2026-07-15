//! chat-server-core.

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
use axum::{Router, routing::get};
use tokio::net::TcpListener;

/// Runs the shared development HTTP shell for a service.
///
/// # Errors
///
/// Returns an error when the listen address is missing, binding fails, or the
/// HTTP server exits with an error.
pub async fn run_service(service_name: &'static str, address_env: &'static str) -> Result<()> {
    chat_foundation_config::load_dotenv();
    chat_foundation_telemetry::init(service_name);

    let address = chat_foundation_config::required(address_env)
        .with_context(|| format!("failed to load listen address from {address_env}"))?;

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(|| async { "ready" }));

    let listener = TcpListener::bind(&address)
        .await
        .with_context(|| format!("failed to bind {service_name} to {address}"))?;

    tracing::info!(service = service_name, %address, "service listening");

    axum::serve(listener, app)
        .await
        .with_context(|| format!("{service_name} server failed"))?;

    Ok(())
}
