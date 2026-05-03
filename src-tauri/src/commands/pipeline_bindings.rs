use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PipelineBindings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manual: Option<String>,
}

fn read_bindings_from_dir(dir: &Path) -> Result<PipelineBindings, String> {
    let path = dir.join("pipeline-bindings.json");
    if !path.exists() {
        return Ok(PipelineBindings::default());
    }
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return Err(format!("read pipeline-bindings: {e}")),
    };
    if content.trim().is_empty() {
        return Ok(PipelineBindings::default());
    }
    // If JSON is corrupted, return empty defaults rather than crashing the UI.
    Ok(serde_json::from_str::<PipelineBindings>(&content).unwrap_or_default())
}

fn write_bindings_to_dir(dir: &Path, bindings: &PipelineBindings) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("create app_data_dir: {e}"))?;
    let path = dir.join("pipeline-bindings.json");
    let tmp = dir.join("pipeline-bindings.json.tmp");
    let json = serde_json::to_string_pretty(bindings).map_err(|e| e.to_string())?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("write tmp: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

fn validate_pipeline_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("pipeline name must not be empty".to_string());
    }
    if name.len() > 128 {
        return Err(format!("pipeline name too long ({} chars, max 128)", name.len()));
    }
    // Allow only the charset used by Claude command file names: letters, digits, hyphens, underscores.
    // This forecloses CR/LF injection into the Claude PTY and path-separator issues.
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!(
            "invalid pipeline name {:?}: only [A-Za-z0-9_-] is allowed",
            name
        ));
    }
    Ok(())
}

fn apply_set(bindings: &mut PipelineBindings, mode: &str, value: Option<String>) -> Result<(), String> {
    match mode {
        "code" => bindings.code = value,
        "debug" => bindings.debug = value,
        "manual" => bindings.manual = value,
        other => return Err(format!("invalid pipeline binding mode: {other}")),
    }
    Ok(())
}

#[tauri::command]
pub fn get_pipeline_bindings(app: AppHandle) -> Result<PipelineBindings, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    read_bindings_from_dir(&dir)
}

#[tauri::command]
pub fn set_pipeline_binding(
    app: AppHandle,
    state: State<'_, AppState>,
    mode: String,
    pipeline_name: String,
) -> Result<(), String> {
    validate_pipeline_name(&pipeline_name)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _guard = state
        .pipeline_bindings_lock
        .lock()
        .map_err(|e| format!("pipeline_bindings_lock poisoned: {e}"))?;
    let mut bindings = read_bindings_from_dir(&dir)?;
    apply_set(&mut bindings, &mode, Some(pipeline_name))?;
    write_bindings_to_dir(&dir, &bindings)
}

#[tauri::command]
pub fn clear_pipeline_binding(
    app: AppHandle,
    state: State<'_, AppState>,
    mode: String,
) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _guard = state
        .pipeline_bindings_lock
        .lock()
        .map_err(|e| format!("pipeline_bindings_lock poisoned: {e}"))?;
    let mut bindings = read_bindings_from_dir(&dir)?;
    apply_set(&mut bindings, &mode, None)?;
    write_bindings_to_dir(&dir, &bindings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn read_missing_file_returns_default() {
        let dir = TempDir::new().unwrap();
        let b = read_bindings_from_dir(dir.path()).unwrap();
        assert!(b.code.is_none());
        assert!(b.debug.is_none());
        assert!(b.manual.is_none());
    }

    #[test]
    fn read_empty_file_returns_default() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("pipeline-bindings.json"), b"").unwrap();
        let b = read_bindings_from_dir(dir.path()).unwrap();
        assert!(b.code.is_none());
        assert!(b.debug.is_none());
        assert!(b.manual.is_none());
    }

    #[test]
    fn read_corrupt_json_returns_default() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("pipeline-bindings.json"), b"not json{").unwrap();
        let b = read_bindings_from_dir(dir.path()).unwrap();
        assert!(b.code.is_none());
        assert!(b.debug.is_none());
        assert!(b.manual.is_none());
    }

    #[test]
    fn round_trip_preserves_bindings() {
        let dir = TempDir::new().unwrap();
        let original = PipelineBindings {
            code: Some("custom-code".to_string()),
            debug: Some("custom-debug".to_string()),
            manual: Some("custom-manual".to_string()),
        };
        write_bindings_to_dir(dir.path(), &original).unwrap();
        let loaded = read_bindings_from_dir(dir.path()).unwrap();
        assert_eq!(loaded.code.as_deref(), Some("custom-code"));
        assert_eq!(loaded.debug.as_deref(), Some("custom-debug"));
        assert_eq!(loaded.manual.as_deref(), Some("custom-manual"));
    }

    #[test]
    fn round_trip_partial_bindings() {
        let dir = TempDir::new().unwrap();
        let original = PipelineBindings {
            code: Some("custom-code".to_string()),
            debug: None,
            manual: None,
        };
        write_bindings_to_dir(dir.path(), &original).unwrap();
        let loaded = read_bindings_from_dir(dir.path()).unwrap();
        assert_eq!(loaded.code.as_deref(), Some("custom-code"));
        assert!(loaded.debug.is_none());
        assert!(loaded.manual.is_none());
    }

    #[test]
    fn set_binding_mutates_only_target_field() {
        let mut b = PipelineBindings {
            code: Some("a".to_string()),
            debug: Some("b".to_string()),
            manual: Some("c".to_string()),
        };
        apply_set(&mut b, "code", Some("new-code".to_string())).unwrap();
        assert_eq!(b.code.as_deref(), Some("new-code"));
        assert_eq!(b.debug.as_deref(), Some("b"));
        assert_eq!(b.manual.as_deref(), Some("c"));

        apply_set(&mut b, "debug", Some("new-debug".to_string())).unwrap();
        assert_eq!(b.code.as_deref(), Some("new-code"));
        assert_eq!(b.debug.as_deref(), Some("new-debug"));
        assert_eq!(b.manual.as_deref(), Some("c"));

        apply_set(&mut b, "manual", Some("new-manual".to_string())).unwrap();
        assert_eq!(b.code.as_deref(), Some("new-code"));
        assert_eq!(b.debug.as_deref(), Some("new-debug"));
        assert_eq!(b.manual.as_deref(), Some("new-manual"));
    }

    #[test]
    fn clear_binding_clears_only_target_field() {
        let mut b = PipelineBindings {
            code: Some("a".to_string()),
            debug: Some("b".to_string()),
            manual: Some("c".to_string()),
        };
        apply_set(&mut b, "debug", None).unwrap();
        assert_eq!(b.code.as_deref(), Some("a"));
        assert!(b.debug.is_none());
        assert_eq!(b.manual.as_deref(), Some("c"));
    }

    #[test]
    fn invalid_mode_returns_error() {
        let mut b = PipelineBindings::default();
        let err = apply_set(&mut b, "bogus", Some("x".to_string())).unwrap_err();
        assert!(err.contains("invalid pipeline binding mode"));
        assert!(err.contains("bogus"));

        let err2 = apply_set(&mut b, "", None).unwrap_err();
        assert!(err2.contains("invalid pipeline binding mode"));
    }

    #[test]
    fn set_then_clear_round_trip_via_disk() {
        let dir = TempDir::new().unwrap();
        // Start with one binding written
        let initial = PipelineBindings {
            code: Some("c1".to_string()),
            debug: None,
            manual: None,
        };
        write_bindings_to_dir(dir.path(), &initial).unwrap();

        // Simulate set: read, mutate, write
        let mut b = read_bindings_from_dir(dir.path()).unwrap();
        apply_set(&mut b, "debug", Some("d1".to_string())).unwrap();
        write_bindings_to_dir(dir.path(), &b).unwrap();

        let loaded = read_bindings_from_dir(dir.path()).unwrap();
        assert_eq!(loaded.code.as_deref(), Some("c1"));
        assert_eq!(loaded.debug.as_deref(), Some("d1"));
        assert!(loaded.manual.is_none());

        // Simulate clear
        let mut b2 = read_bindings_from_dir(dir.path()).unwrap();
        apply_set(&mut b2, "code", None).unwrap();
        write_bindings_to_dir(dir.path(), &b2).unwrap();

        let loaded2 = read_bindings_from_dir(dir.path()).unwrap();
        assert!(loaded2.code.is_none());
        assert_eq!(loaded2.debug.as_deref(), Some("d1"));
    }

    #[test]
    fn concurrent_writes_under_lock_preserve_all_mutations() {
        use std::sync::{Arc, Mutex};
        use std::thread;

        let dir = TempDir::new().unwrap();
        let dir_path = dir.path().to_path_buf();
        let lock = Arc::new(Mutex::new(()));

        // Each thread sets a different mode field. Without the lock these would race
        // on the read-modify-write and lose each other's mutations.
        let modes = ["code", "debug", "manual"];
        let mut handles = Vec::new();
        for mode in modes {
            let dir_path = dir_path.clone();
            let lock = Arc::clone(&lock);
            handles.push(thread::spawn(move || {
                // Run several iterations to widen the interleaving window.
                for i in 0..20 {
                    let _g = lock.lock().unwrap();
                    let mut b = read_bindings_from_dir(&dir_path).unwrap();
                    apply_set(&mut b, mode, Some(format!("{mode}-{i}"))).unwrap();
                    write_bindings_to_dir(&dir_path, &b).unwrap();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        let final_state = read_bindings_from_dir(&dir_path).unwrap();
        // After serialization, every thread's last write must be present.
        assert_eq!(final_state.code.as_deref(), Some("code-19"));
        assert_eq!(final_state.debug.as_deref(), Some("debug-19"));
        assert_eq!(final_state.manual.as_deref(), Some("manual-19"));
    }

    #[test]
    fn atomic_write_leaves_no_tmp() {
        let dir = TempDir::new().unwrap();
        write_bindings_to_dir(dir.path(), &PipelineBindings::default()).unwrap();
        assert!(dir.path().join("pipeline-bindings.json").exists());
        assert!(!dir.path().join("pipeline-bindings.json.tmp").exists());
    }

    #[test]
    fn validate_pipeline_name_accepts_valid_names() {
        assert!(validate_pipeline_name("reggie-code-workflow").is_ok());
        assert!(validate_pipeline_name("my_custom_pipeline").is_ok());
        assert!(validate_pipeline_name("Pipeline123").is_ok());
        assert!(validate_pipeline_name("a").is_ok());
        assert!(validate_pipeline_name(&"x".repeat(128)).is_ok());
    }

    #[test]
    fn validate_pipeline_name_rejects_invalid() {
        // Empty
        assert!(validate_pipeline_name("").is_err());
        // Too long
        assert!(validate_pipeline_name(&"a".repeat(129)).is_err());
        // CR/LF injection
        assert!(validate_pipeline_name("good\nbad").is_err());
        assert!(validate_pipeline_name("good\rbad").is_err());
        // Space
        assert!(validate_pipeline_name("my pipeline").is_err());
        // Slash (path traversal guard)
        assert!(validate_pipeline_name("a/b").is_err());
        // Other specials
        assert!(validate_pipeline_name("cmd;evil").is_err());
    }
}
