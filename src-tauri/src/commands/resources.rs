use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};

/// Known resource subdirectory names bundled under `reggie-resources/`.
const RESOURCE_SUBDIRS: &[&str] = &["agents", "commands", "hooks", "docs", "registries"];

/// Metadata about a single bundled resource file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFile {
    /// Filename (e.g. "reggie-rust-developer.md").
    pub name: String,
    /// Absolute path to the file on disk.
    pub path: String,
}

/// Validates that `subdir` is one of the known resource subdirectory names.
///
/// Returns `Ok(())` if valid, or an `Err` with a descriptive message if not.
pub fn validate_subdirectory(subdir: &str) -> Result<(), String> {
    if !RESOURCE_SUBDIRS.contains(&subdir) {
        return Err(format!(
            "Invalid resource subdirectory: '{}'. Must be one of: {}",
            subdir,
            RESOURCE_SUBDIRS.join(", ")
        ));
    }
    Ok(())
}

/// Lists all `.md` files in `dir`, sorted case-insensitively by filename.
///
/// Returns an empty list if `dir` does not exist or is not a directory.
pub fn list_md_files(dir: &Path) -> Result<Vec<ResourceFile>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {e}", dir.display()))?;

    let mut files: Vec<ResourceFile> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                return None;
            }
            let name = path.file_name()?.to_string_lossy().to_string();
            Some(ResourceFile {
                name,
                path: path.to_string_lossy().to_string(),
            })
        })
        .collect();

    files.sort_by_key(|a| a.name.to_lowercase());

    Ok(files)
}

/// Returns the absolute path to the base bundled resource directory (`reggie-resources/`).
///
/// In production builds this resolves into the app bundle
/// (e.g. `.app/Contents/Resources/reggie-resources` on macOS).
/// In dev mode (`tauri dev`) it resolves relative to the built executable.
#[tauri::command]
pub fn get_resource_dir(app: AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {e}"))?;

    let reggie_dir = base.join("reggie-resources");
    Ok(reggie_dir.to_string_lossy().to_string())
}

/// Lists all `.md` files in a bundled resource subdirectory.
///
/// `subdirectory` must be one of: `agents`, `commands`, `hooks`, `docs`, `registries`.
/// Returns file metadata sorted alphabetically by name.
/// Returns an empty list if the subdirectory does not exist (graceful for dev mode).
#[tauri::command]
pub fn list_resource_files(
    app: AppHandle,
    subdirectory: String,
) -> Result<Vec<ResourceFile>, String> {
    validate_subdirectory(&subdirectory)?;

    let base = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {e}"))?;

    let dir = base.join("reggie-resources").join(&subdirectory);
    list_md_files(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn resource_subdirs_contains_expected_entries() {
        assert!(RESOURCE_SUBDIRS.contains(&"agents"));
        assert!(RESOURCE_SUBDIRS.contains(&"commands"));
        assert!(RESOURCE_SUBDIRS.contains(&"hooks"));
        assert!(RESOURCE_SUBDIRS.contains(&"docs"));
        assert!(RESOURCE_SUBDIRS.contains(&"registries"));
    }

    #[test]
    fn resource_subdirs_rejects_unknown() {
        assert!(!RESOURCE_SUBDIRS.contains(&"secrets"));
        assert!(!RESOURCE_SUBDIRS.contains(&"../etc"));
    }

    // --- validate_subdirectory ---

    #[test]
    fn validate_subdirectory_accepts_all_valid_names() {
        for name in RESOURCE_SUBDIRS {
            assert!(
                validate_subdirectory(name).is_ok(),
                "expected '{}' to be accepted",
                name
            );
        }
    }

    #[test]
    fn validate_subdirectory_rejects_unknown_name() {
        let result = validate_subdirectory("secrets");
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(
            msg.contains("Invalid resource subdirectory: 'secrets'"),
            "error message should name the bad input, got: {msg}"
        );
    }

    #[test]
    fn validate_subdirectory_rejects_path_traversal() {
        assert!(validate_subdirectory("../etc").is_err());
        assert!(validate_subdirectory("..").is_err());
        assert!(validate_subdirectory("agents/../secrets").is_err());
    }

    #[test]
    fn validate_subdirectory_rejects_empty_string() {
        assert!(validate_subdirectory("").is_err());
    }

    #[test]
    fn validate_subdirectory_error_lists_valid_options() {
        let err = validate_subdirectory("nope").unwrap_err();
        for name in RESOURCE_SUBDIRS {
            assert!(
                err.contains(name),
                "error message should list '{}' as a valid option, got: {err}",
                name
            );
        }
    }

    // --- list_md_files ---

    #[test]
    fn list_md_files_returns_only_md_files() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        File::create(dir.join("alpha.md")).unwrap();
        File::create(dir.join("beta.txt")).unwrap();
        File::create(dir.join("gamma.yaml")).unwrap();
        File::create(dir.join("delta.md")).unwrap();

        let files = list_md_files(dir).unwrap();
        let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();

        assert_eq!(names.len(), 2);
        assert!(names.contains(&"alpha.md"));
        assert!(names.contains(&"delta.md"));
        assert!(!names.contains(&"beta.txt"));
        assert!(!names.contains(&"gamma.yaml"));
    }

    #[test]
    fn list_md_files_sorts_case_insensitively() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        File::create(dir.join("Zebra.md")).unwrap();
        File::create(dir.join("apple.md")).unwrap();
        File::create(dir.join("Banana.md")).unwrap();
        File::create(dir.join("cherry.md")).unwrap();

        let files = list_md_files(dir).unwrap();
        let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();

        assert_eq!(names, vec!["apple.md", "Banana.md", "cherry.md", "Zebra.md"]);
    }

    #[test]
    fn list_md_files_returns_empty_vec_for_empty_directory() {
        let tmp = TempDir::new().unwrap();
        let files = list_md_files(tmp.path()).unwrap();
        assert!(files.is_empty());
    }

    #[test]
    fn list_md_files_returns_empty_vec_for_nonexistent_directory() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("does_not_exist");
        let files = list_md_files(&missing).unwrap();
        assert!(files.is_empty());
    }

    #[test]
    fn list_md_files_ignores_nested_directories() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        File::create(dir.join("readme.md")).unwrap();
        fs::create_dir(dir.join("subdir.md")).unwrap(); // directory whose name ends in .md

        let files = list_md_files(dir).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "readme.md");
    }

    #[test]
    fn list_md_files_populates_path_field() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        File::create(dir.join("test.md")).unwrap();

        let files = list_md_files(dir).unwrap();
        assert_eq!(files.len(), 1);
        assert!(
            files[0].path.ends_with("test.md"),
            "path should end with the filename, got: {}",
            files[0].path
        );
        assert!(
            files[0].path.contains(dir.to_str().unwrap()),
            "path should contain the parent directory"
        );
    }

    #[test]
    fn list_md_files_excludes_files_without_extension() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        File::create(dir.join("Makefile")).unwrap();
        File::create(dir.join("LICENSE")).unwrap();
        File::create(dir.join("notes.md")).unwrap();

        let files = list_md_files(dir).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "notes.md");
    }

    #[test]
    fn list_md_files_excludes_files_with_md_in_stem_but_wrong_extension() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        File::create(dir.join("readme.md.bak")).unwrap();
        File::create(dir.join("md_notes.txt")).unwrap();
        File::create(dir.join("actual.md")).unwrap();

        let files = list_md_files(dir).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "actual.md");
    }

    #[test]
    fn list_md_files_handles_many_files() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        for i in 0..50 {
            let mut f = File::create(dir.join(format!("file_{:03}.md", i))).unwrap();
            writeln!(f, "# File {}", i).unwrap();
        }

        let files = list_md_files(dir).unwrap();
        assert_eq!(files.len(), 50);
        // Verify sort order
        assert_eq!(files[0].name, "file_000.md");
        assert_eq!(files[49].name, "file_049.md");
    }

    #[test]
    fn list_md_files_returns_empty_vec_when_path_is_a_file() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("not_a_dir.md");
        File::create(&file_path).unwrap();

        let files = list_md_files(&file_path).unwrap();
        assert!(
            files.is_empty(),
            "should return empty vec when path is a file, not a directory"
        );
    }

    #[test]
    fn list_md_files_includes_hidden_dotfiles() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        File::create(dir.join(".hidden.md")).unwrap();
        File::create(dir.join("visible.md")).unwrap();

        let files = list_md_files(dir).unwrap();
        let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();

        assert_eq!(names.len(), 2);
        assert!(names.contains(&".hidden.md"));
        assert!(names.contains(&"visible.md"));
    }

    #[test]
    fn validate_subdirectory_is_case_sensitive() {
        assert!(
            validate_subdirectory("Agents").is_err(),
            "validation should be case-sensitive — 'Agents' is not 'agents'"
        );
        assert!(
            validate_subdirectory("COMMANDS").is_err(),
            "validation should be case-sensitive — 'COMMANDS' is not 'commands'"
        );
    }

    // --- ResourceFile ---

    #[test]
    fn resource_file_serializes_with_camel_case() {
        let rf = ResourceFile {
            name: "test.md".to_string(),
            path: "/tmp/test.md".to_string(),
        };

        let json = serde_json::to_value(&rf).unwrap();
        let obj = json.as_object().unwrap();

        // Verify camelCase keys are present
        assert!(obj.contains_key("name"), "should have 'name' key");
        assert!(obj.contains_key("path"), "should have 'path' key");

        // Verify values
        assert_eq!(obj["name"], "test.md");
        assert_eq!(obj["path"], "/tmp/test.md");

        // Verify no snake_case keys leaked — with only 2 fields that are
        // already single-word, verify the total key count is exactly 2
        assert_eq!(obj.len(), 2, "should have exactly 2 fields");
    }

    #[test]
    fn resource_file_implements_debug() {
        let rf = ResourceFile {
            name: "test.md".to_string(),
            path: "/some/path/test.md".to_string(),
        };
        let debug_str = format!("{:?}", rf);
        assert!(debug_str.contains("test.md"));
        assert!(debug_str.contains("ResourceFile"));
    }
}
