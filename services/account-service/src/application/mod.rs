//! Account application rules.

use chat_server_core::ApiError;

use crate::domain::NewAccount;

const USERNAME_MIN: usize = 3;
const USERNAME_MAX: usize = 32;
const DISPLAY_NAME_MAX: usize = 64;

pub(crate) fn validate_new_account(
    username: &str,
    display_name: &str,
) -> Result<NewAccount, ApiError> {
    let username = username.trim();
    let display_name = display_name.trim();

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

    if display_name.is_empty() || display_name.chars().count() > DISPLAY_NAME_MAX {
        return Err(ApiError::bad_request(
            "invalid_display_name",
            format!("display name must contain 1-{DISPLAY_NAME_MAX} characters"),
        ));
    }

    Ok(NewAccount {
        username: username.to_owned(),
        username_normalized: username.to_ascii_lowercase(),
        display_name: display_name.to_owned(),
    })
}

pub(crate) fn normalize_search_query(query: Option<&str>) -> Option<String> {
    query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::{normalize_search_query, validate_new_account};

    #[test]
    fn normalizes_a_valid_username() {
        let account = validate_new_account("  Alice_01  ", " Alice ").ok();
        assert_eq!(
            account.as_ref().map(|value| value.username.as_str()),
            Some("Alice_01")
        );
        assert_eq!(
            account
                .as_ref()
                .map(|value| value.username_normalized.as_str()),
            Some("alice_01")
        );
        assert_eq!(
            account.as_ref().map(|value| value.display_name.as_str()),
            Some("Alice")
        );
    }

    #[test]
    fn rejects_non_ascii_username_characters() {
        let result = validate_new_account("爱丽丝", "Alice");
        assert!(result.is_err());
    }

    #[test]
    fn trims_and_normalizes_search_queries() {
        assert_eq!(
            normalize_search_query(Some("  ALIce  ")).as_deref(),
            Some("alice")
        );
        assert_eq!(normalize_search_query(Some("   ")), None);
        assert_eq!(normalize_search_query(None), None);
    }
}
