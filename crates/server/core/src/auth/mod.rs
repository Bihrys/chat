//! Shared bearer-session authentication client for server services.
//!
//! `auth-service` owns the authentication database. Other services validate an
//! opaque bearer token through the auth-service introspection contract instead
//! of reading `chat_auth` directly.

use anyhow::{Context, Result};
use axum::http::{HeaderMap, header};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::ApiError;

const MAX_ACCESS_TOKEN_LEN: usize = 512;

#[derive(Clone)]
pub struct SessionVerifier {
    client: reqwest::Client,
    introspection_url: String,
    readiness_url: String,
}

#[derive(Clone, Debug)]
pub struct AuthenticatedSession {
    pub account_id: Uuid,
    pub session_id: Uuid,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
struct IntrospectionResponse {
    account_id: Uuid,
    session_id: Uuid,
    expires_at: String,
}

impl SessionVerifier {
    /// Builds an auth-service client from `AUTH_SERVICE_ADDR`.
    ///
    /// # Errors
    ///
    /// Returns an error when the service address is missing or malformed.
    pub fn connect_from_env() -> Result<Self> {
        let address = chat_foundation_config::required("AUTH_SERVICE_ADDR")
            .context("AUTH_SERVICE_ADDR is required")?;
        let base_url = local_http_base(&address)?;
        Ok(Self {
            client: reqwest::Client::new(),
            introspection_url: format!("{base_url}/v1/auth/introspect"),
            readiness_url: format!("{base_url}/readyz"),
        })
    }

    /// Checks whether auth-service is reachable.
    ///
    /// # Errors
    ///
    /// Returns an error when the readiness request fails.
    pub async fn healthcheck(&self) -> Result<()> {
        let response = self
            .client
            .get(&self.readiness_url)
            .send()
            .await
            .context("failed to reach auth-service readiness endpoint")?;
        if !response.status().is_success() {
            anyhow::bail!(
                "auth-service readiness endpoint returned HTTP {}",
                response.status()
            );
        }
        Ok(())
    }

    /// Authenticates the `Authorization: Bearer ...` header.
    pub async fn authenticate_headers(
        &self,
        headers: &HeaderMap,
    ) -> Result<AuthenticatedSession, ApiError> {
        let token = bearer_token(headers)?;
        self.authenticate_token(token).await
    }

    /// Authenticates an opaque access token through auth-service.
    pub async fn authenticate_token(&self, token: &str) -> Result<AuthenticatedSession, ApiError> {
        let token = validate_token_shape(token)?;
        let response = self
            .client
            .get(&self.introspection_url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| {
                tracing::error!(
                    ?error,
                    "failed to reach auth-service introspection endpoint"
                );
                ApiError::internal("authentication service unavailable")
            })?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ApiError::unauthorized("invalid or expired session"));
        }
        if !response.status().is_success() {
            tracing::error!(status = %response.status(), "auth-service introspection failed");
            return Err(ApiError::internal("authentication service unavailable"));
        }

        let payload = response
            .json::<IntrospectionResponse>()
            .await
            .map_err(|error| {
                tracing::error!(?error, "invalid auth-service introspection response");
                ApiError::internal("authentication service unavailable")
            })?;
        let expires_at = OffsetDateTime::parse(&payload.expires_at, &Rfc3339).map_err(|error| {
            tracing::error!(?error, "invalid session expiry from auth-service");
            ApiError::internal("authentication service unavailable")
        })?;

        Ok(AuthenticatedSession {
            account_id: payload.account_id,
            session_id: payload.session_id,
            expires_at,
        })
    }
}

#[must_use]
pub fn hash_access_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// Extracts and validates the bearer token syntax from HTTP headers.
pub fn bearer_token(headers: &HeaderMap) -> Result<&str, ApiError> {
    let value = headers
        .get(header::AUTHORIZATION)
        .ok_or_else(|| ApiError::unauthorized("missing bearer token"))?
        .to_str()
        .map_err(|_| ApiError::unauthorized("invalid bearer token"))?;

    let mut parts = value.splitn(2, ' ');
    let scheme = parts.next().unwrap_or_default();
    let token = parts.next().unwrap_or_default();
    if !scheme.eq_ignore_ascii_case("bearer") {
        return Err(ApiError::unauthorized("invalid bearer token"));
    }
    validate_token_shape(token)
}

fn validate_token_shape(token: &str) -> Result<&str, ApiError> {
    let token = token.trim();
    if token.is_empty() || token.len() > MAX_ACCESS_TOKEN_LEN {
        return Err(ApiError::unauthorized("invalid or expired session"));
    }
    Ok(token)
}

fn local_http_base(address: &str) -> Result<String> {
    let address = address.trim().trim_end_matches('/');
    if address.is_empty() {
        anyhow::bail!("AUTH_SERVICE_ADDR is empty");
    }
    if address.starts_with("http://") || address.starts_with("https://") {
        return Ok(address.to_owned());
    }
    Ok(format!("http://{address}"))
}
