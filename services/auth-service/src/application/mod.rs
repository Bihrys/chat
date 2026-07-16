//! Registration, password, and session-token application rules.

use anyhow::{Result, anyhow};
use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};

use chat_server_core::ApiError;

use crate::domain::Registration;

const USERNAME_MIN: usize = 3;
const USERNAME_MAX: usize = 32;
const DISPLAY_NAME_MAX: usize = 64;
const PASSWORD_MIN: usize = 8;
const PASSWORD_MAX: usize = 128;

pub(crate) fn validate_registration(
    username: &str,
    display_name: &str,
    password: &str,
) -> Result<Registration, ApiError> {
    let username = username.trim();
    let display_name = display_name.trim();

    validate_username(username)?;

    if display_name.is_empty() || display_name.chars().count() > DISPLAY_NAME_MAX {
        return Err(ApiError::bad_request(
            "invalid_display_name",
            format!("display name must contain 1-{DISPLAY_NAME_MAX} characters"),
        ));
    }

    let password_len = password.chars().count();
    if !(PASSWORD_MIN..=PASSWORD_MAX).contains(&password_len) {
        return Err(ApiError::bad_request(
            "invalid_password",
            format!("password must contain {PASSWORD_MIN}-{PASSWORD_MAX} characters"),
        ));
    }

    Ok(Registration {
        username: username.to_owned(),
        username_normalized: username.to_ascii_lowercase(),
        display_name: display_name.to_owned(),
        password: password.to_owned(),
    })
}

pub(crate) fn normalize_login_username(username: &str) -> Result<String, ApiError> {
    let username = username.trim();
    validate_username(username)
        .map_err(|_| ApiError::unauthorized("invalid username or password"))?;
    Ok(username.to_ascii_lowercase())
}

pub(crate) fn hash_password(password: &str) -> Result<String> {
    let mut salt_bytes = [0_u8; 16];
    getrandom::fill(&mut salt_bytes)
        .map_err(|error| anyhow!("failed to generate password salt: {error}"))?;
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|error| anyhow!("failed to encode password salt: {error}"))?;

    password_hasher()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| anyhow!("failed to hash password: {error}"))
}

pub(crate) fn verify_password(password: &str, encoded_hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(encoded_hash) else {
        return false;
    };
    password_hasher()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub(crate) fn generate_access_token() -> Result<String> {
    let mut token_bytes = [0_u8; 32];
    getrandom::fill(&mut token_bytes)
        .map_err(|error| anyhow!("failed to generate session token: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(token_bytes))
}

fn password_hasher() -> Argon2<'static> {
    Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::default())
}

fn validate_username(username: &str) -> Result<(), ApiError> {
    if !(USERNAME_MIN..=USERNAME_MAX).contains(&username.len()) {
        return Err(ApiError::bad_request(
            "invalid_username",
            format!("username must be {USERNAME_MIN}-{USERNAME_MAX} ASCII characters"),
        ));
    }

    if !username
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err(ApiError::bad_request(
            "invalid_username",
            "username may contain only ASCII letters, numbers, and underscore",
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{hash_password, validate_registration, verify_password};

    #[test]
    fn validates_and_normalizes_registration() {
        let registration = validate_registration(" Alice_01 ", " Alice ", "password123");
        assert!(registration.is_ok());
        let registration = registration.ok();
        assert_eq!(
            registration
                .as_ref()
                .map(|value| value.username_normalized.as_str()),
            Some("alice_01")
        );
    }

    #[test]
    fn password_round_trip() {
        let hash = hash_password("correct horse battery staple");
        assert!(hash.is_ok());
        let hash = hash.ok().unwrap_or_default();
        assert!(verify_password("correct horse battery staple", &hash));
        assert!(!verify_password("wrong password", &hash));
    }
}
