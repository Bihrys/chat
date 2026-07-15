mod api;
mod application;
mod domain;
mod infrastructure;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    chat_server_core::run_service(env!("CARGO_PKG_NAME"), "PROFILE_SERVICE_ADDR").await
}
