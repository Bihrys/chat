//! chat-foundation-telemetry.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod metrics;
pub mod redaction;
pub mod tracing;

use std::sync::Once;

use tracing_subscriber::EnvFilter;

static INIT: Once = Once::new();

/// Initializes process-wide tracing once and records the service identity.
pub fn init(service_name: &'static str) {
    INIT.call_once(|| {
        let default_level = std::env::var("CHAT_LOG_LEVEL").unwrap_or_else(|_| "info".to_owned());
        let filter =
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level));

        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .try_init();
    });

    ::tracing::info!(service = service_name, "telemetry initialized");
}
