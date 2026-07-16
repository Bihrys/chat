mod api;
mod application;
mod domain;
mod infrastructure;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    chat_foundation_config::load_dotenv();
    let auth = infrastructure::AuthRepository::connect().await?;
    let accounts = infrastructure::AccountDirectoryClient::connect_from_env()?;
    let app = api::router(api::AppState { auth, accounts });

    chat_server_core::serve_router(env!("CARGO_PKG_NAME"), "AUTH_SERVICE_ADDR", app).await
}
