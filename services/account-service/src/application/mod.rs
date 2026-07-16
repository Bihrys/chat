//! Account-directory validation and query rules.

use chat_server_core::ApiError;

const USERNAME_MIN: usize = 3;
const USERNAME_MAX: usize = 32;
const DISPLAY_NAME_MAX: usize = 64;

pub(crate) fn normalize_search_query(query: Option<&str>) -> Option<String> {
    query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

pub(crate) fn validate_internal_account(
    username: &str,
    username_normalized: &str,
    display_name: &str,
) -> Result<(), ApiError> {
    if !(USERNAME_MIN..=USERNAME_MAX).contains(&username.len())
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        || username.to_ascii_lowercase() != username_normalized
    {
        return Err(ApiError::bad_request(
            "invalid_username",
            "invalid account-service username contract",
        ));
    }
    validate_display_name(display_name)
}

pub(crate) fn validate_display_name(display_name: &str) -> Result<(), ApiError> {
    let display_name = display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > DISPLAY_NAME_MAX {
        return Err(ApiError::bad_request(
            "invalid_display_name",
            format!("display name must contain 1-{DISPLAY_NAME_MAX} characters"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{normalize_search_query, validate_internal_account};

    #[test]
    fn trims_and_normalizes_search_queries() {
        assert_eq!(
            normalize_search_query(Some("  ALIce  ")).as_deref(),
            Some("alice")
        );
        assert_eq!(normalize_search_query(Some("   ")), None);
        assert_eq!(normalize_search_query(None), None);
    }

    #[test]
    fn validates_internal_account_contract() {
        assert!(validate_internal_account("Alice_01", "alice_01", "Alice").is_ok());
        assert!(validate_internal_account("Alice-01", "alice-01", "Alice").is_err());
    }
}
