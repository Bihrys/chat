mod api;
mod application;
mod domain;
mod infrastructure;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    chat_foundation_config::load_dotenv();
    let accounts = infrastructure::AccountRepository::connect().await?;
    let app = api::router(api::AppState { accounts });

    chat_server_core::serve_router(env!("CARGO_PKG_NAME"), "ACCOUNT_SERVICE_ADDR", app).await
}
