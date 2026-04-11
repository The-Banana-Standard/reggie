/// Splits markdown content into optional YAML frontmatter and the remaining body.
///
/// Frontmatter is detected by an opening `---` at the start of the content and a
/// closing `\n---` delimiter. When present, returns `(Some(frontmatter), body)` where
/// `frontmatter` is the raw text between the delimiters and `body` is everything after
/// the closing delimiter with leading newlines trimmed. When absent, returns
/// `(None, content)` with the original content unchanged.
pub fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    if let Some(rest) = content.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let frontmatter = &rest[..end];
            let body = &rest[end + 4..];
            let body = body.trim_start_matches('\n');
            return (Some(frontmatter), body);
        }
    }
    (None, content)
}

/// Strips surrounding double or single quotes from a string value.
///
/// Trims whitespace first, then removes matched quote pairs. Mismatched quotes
/// (e.g., `"hello'`) are left as-is.
pub fn strip_quotes(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── split_frontmatter: valid inputs ──

    #[test]
    fn split_frontmatter_valid() {
        let content = "---\nname: test\ndescription: hello\n---\n# Body";
        let (fm, _) = split_frontmatter(content);
        assert_eq!(fm, Some("\nname: test\ndescription: hello"));
    }

    #[test]
    fn split_frontmatter_returns_both_parts() {
        let content = "---\nkey: value\n---\n# Body text here";
        let (fm, body) = split_frontmatter(content);
        assert_eq!(fm, Some("\nkey: value"));
        assert_eq!(body, "# Body text here");
    }

    #[test]
    fn split_frontmatter_body_after_frontmatter() {
        let input = "---\ntitle: My Skill\nauthor: test\n---\n# Hello\nThis is content.";
        let (_, body) = split_frontmatter(input);
        assert_eq!(body, "# Hello\nThis is content.");
    }

    #[test]
    fn split_frontmatter_empty_frontmatter() {
        let content = "---\n---\nBody after empty frontmatter";
        let (fm, body) = split_frontmatter(content);
        assert_eq!(fm, Some(""));
        assert_eq!(body, "Body after empty frontmatter");
    }

    #[test]
    fn split_frontmatter_multi_field_with_complex_body() {
        let content = "---\ntitle: Test\nauthor: Someone\ntags: rust, testing\n---\n\n# Main Heading\n\nParagraph of body content.\n\n## Subheading\nMore content.";
        let (fm, body) = split_frontmatter(content);
        assert_eq!(fm, Some("\ntitle: Test\nauthor: Someone\ntags: rust, testing"));
        assert_eq!(body, "# Main Heading\n\nParagraph of body content.\n\n## Subheading\nMore content.");
    }

    #[test]
    fn split_frontmatter_trims_leading_newlines_from_body() {
        let content = "---\nkey: val\n---\n\n\n\nBody after newlines";
        let (_, body) = split_frontmatter(content);
        assert_eq!(body, "Body after newlines");
    }

    #[test]
    fn split_frontmatter_crlf_line_endings() {
        let content = "---\r\nname: test\r\ndescription: hello\r\n---\r\n# Body";
        let (fm, body) = split_frontmatter(content);
        // CRLF: \r chars remain since only \n is used as delimiter
        assert_eq!(fm, Some("\r\nname: test\r\ndescription: hello\r"));
        // Body retains leading \r because trim_start_matches('\n') does not strip \r
        assert_eq!(body, "\r\n# Body");
    }

    // ── split_frontmatter: missing / malformed inputs ──

    #[test]
    fn split_frontmatter_missing_opening() {
        let content = "name: test\n---\n# Body";
        let (fm, body) = split_frontmatter(content);
        assert!(fm.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn split_frontmatter_missing_closing() {
        let content = "---\nname: test\n# Body";
        let (fm, body) = split_frontmatter(content);
        assert!(fm.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn split_frontmatter_empty_input() {
        let (fm, body) = split_frontmatter("");
        assert!(fm.is_none());
        assert_eq!(body, "");
    }

    #[test]
    fn split_frontmatter_without_frontmatter_returns_full_content() {
        let input = "# Hello\nThis is content.";
        let (fm, body) = split_frontmatter(input);
        assert!(fm.is_none());
        assert_eq!(body, input);
    }

    #[test]
    fn split_frontmatter_no_frontmatter_multiline() {
        let content = "Just plain text\nwith multiple lines";
        let (fm, body) = split_frontmatter(content);
        assert!(fm.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn split_frontmatter_unclosed_returns_full_content() {
        let input = "---\ntitle: Unclosed\nNo closing delimiter here";
        let (fm, body) = split_frontmatter(input);
        assert!(fm.is_none());
        assert_eq!(body, input);
    }

    #[test]
    fn split_frontmatter_only_opening_delimiter() {
        let (fm, body) = split_frontmatter("---");
        assert!(fm.is_none());
        assert_eq!(body, "---");
    }

    #[test]
    fn split_frontmatter_only_opening_delimiter_with_newline() {
        let (fm, body) = split_frontmatter("---\n");
        assert!(fm.is_none());
        assert_eq!(body, "---\n");
    }

    // ── split_frontmatter: boundary / tricky cases ──

    #[test]
    fn split_frontmatter_triple_dash_in_body_not_treated_as_second_split() {
        let content = "---\nkey: val\n---\nBody line\n---\nMore body";
        let (fm, body) = split_frontmatter(content);
        assert_eq!(fm, Some("\nkey: val"));
        // The second --- is part of the body, not a delimiter
        assert_eq!(body, "Body line\n---\nMore body");
    }

    #[test]
    fn split_frontmatter_body_is_empty_after_closing() {
        let content = "---\nkey: val\n---";
        let (fm, body) = split_frontmatter(content);
        assert_eq!(fm, Some("\nkey: val"));
        assert_eq!(body, "");
    }

    #[test]
    fn split_frontmatter_closing_delimiter_must_follow_newline() {
        // "---key---" — the closing --- is not preceded by \n, so no split
        let content = "---key---";
        let (fm, body) = split_frontmatter(content);
        assert!(fm.is_none());
        assert_eq!(body, content);
    }

    // ── strip_quotes tests ──

    #[test]
    fn strip_quotes_double() {
        assert_eq!(strip_quotes("\"hello world\""), "hello world");
    }

    #[test]
    fn strip_quotes_single() {
        assert_eq!(strip_quotes("'hello'"), "hello");
    }

    #[test]
    fn strip_quotes_none() {
        assert_eq!(strip_quotes("hello"), "hello");
    }

    #[test]
    fn strip_quotes_mismatched_double_single() {
        assert_eq!(strip_quotes("\"hello'"), "\"hello'");
    }

    #[test]
    fn strip_quotes_mismatched_single_double() {
        assert_eq!(strip_quotes("'hello\""), "'hello\"");
    }

    #[test]
    fn strip_quotes_whitespace_trimmed() {
        assert_eq!(strip_quotes("  \"hello\"  "), "hello");
        assert_eq!(strip_quotes("  'world'  "), "world");
        assert_eq!(strip_quotes("  unquoted  "), "unquoted");
    }

    #[test]
    fn strip_quotes_empty_string() {
        assert_eq!(strip_quotes(""), "");
    }

    #[test]
    fn strip_quotes_empty_double_quoted() {
        assert_eq!(strip_quotes("\"\""), "");
    }

    #[test]
    fn strip_quotes_empty_single_quoted() {
        assert_eq!(strip_quotes("''"), "");
    }

    #[test]
    fn strip_quotes_single_quote_char_not_stripped() {
        // A single quote character alone has matching start/end — but length is 1,
        // so [1..0] would panic. Let's verify behavior.
        assert_eq!(strip_quotes("\""), "\"");
        assert_eq!(strip_quotes("'"), "'");
    }
}
