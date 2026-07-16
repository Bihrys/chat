mod api;
mod application;
mod domain;
mod infrastructure;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    chat_foundation_config::load_dotenv();
    let mailbox = infrastructure::MailboxRepository::connect().await?;
    let sessions = chat_server_core::auth::SessionVerifier::connect_from_env()?;
    let contacts = infrastructure::ContactVerifier::connect_from_env()?;
    let app = api::router(api::AppState {
        mailbox,
        sessions,
        contacts,
        events: api::EventHub::default(),
    });

    chat_server_core::serve_router(env!("CARGO_PKG_NAME"), "MAILBOX_STORE_ADDR", app).await
}
