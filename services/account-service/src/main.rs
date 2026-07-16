mod api;
mod application;
mod domain;
mod infrastructure;

use std::sync::Arc;

use anyhow::{Context, bail};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    chat_foundation_config::load_dotenv();
    let accounts = infrastructure::AccountRepository::connect().await?;
    let sessions = chat_server_core::auth::SessionVerifier::connect_from_env()?;
    let internal_token = chat_foundation_config::required("CHAT_INTERNAL_SERVICE_TOKEN")
        .context("CHAT_INTERNAL_SERVICE_TOKEN is required")?;
    if internal_token.trim().is_empty() {
        bail!("CHAT_INTERNAL_SERVICE_TOKEN must not be empty");
    }
    let app = api::router(api::AppState {
        accounts,
        sessions,
        internal_token: Arc::from(internal_token),
    });

    chat_server_core::serve_router(env!("CARGO_PKG_NAME"), "ACCOUNT_SERVICE_ADDR", app).await
}
