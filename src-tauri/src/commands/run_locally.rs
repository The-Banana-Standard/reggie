use serde::Serialize;
use std::net::TcpListener;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunScriptInfo {
    pub exists: bool,
    pub script_path: String,
    pub port: u16,
}

/// Checks if a `.forge/run.sh` (macOS/Linux) or `.forge/run.ps1` (Windows)
/// script exists for the given project, and finds a free TCP port.
#[tauri::command]
pub fn check_run_script(project_path: String) -> Result<RunScriptInfo, String> {
    let script_name = if cfg!(target_os = "windows") {
        "run.ps1"
    } else {
        "run.sh"
    };

    let script_path: PathBuf = [&project_path, ".forge", script_name].iter().collect();
    let exists = script_path.exists();

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to find free port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {e}"))?
        .port();

    Ok(RunScriptInfo {
        exists,
        script_path: script_path.to_string_lossy().to_string(),
        port,
    })
}

/// Opens a URL in the default browser using the platform-specific command.
#[tauri::command]
pub fn open_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();

    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn();

    result.map_err(|e| format!("Failed to open browser: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_run_script_exists() {
        let dir = tempfile::tempdir().unwrap();
        let forge_dir = dir.path().join(".forge");
        std::fs::create_dir_all(&forge_dir).unwrap();

        let script_name = if cfg!(target_os = "windows") { "run.ps1" } else { "run.sh" };
        std::fs::write(forge_dir.join(script_name), "#!/bin/sh\necho hello").unwrap();

        let result = check_run_script(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());

        let info = result.unwrap();
        assert!(info.exists);
        assert!(info.script_path.ends_with(&format!(".forge{}{}", std::path::MAIN_SEPARATOR, script_name)));
        assert!(info.port > 0);
    }

    #[test]
    fn check_run_script_missing() {
        let dir = tempfile::tempdir().unwrap();
        // No .forge/ directory created

        let result = check_run_script(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());

        let info = result.unwrap();
        assert!(!info.exists);
        assert!(info.port > 0);
    }

    #[test]
    fn check_run_script_path_correct() {
        let dir = tempfile::tempdir().unwrap();
        let project_path = dir.path().to_string_lossy().to_string();

        let info = check_run_script(project_path.clone()).unwrap();

        let script_name = if cfg!(target_os = "windows") { "run.ps1" } else { "run.sh" };
        let expected: PathBuf = [&project_path, ".forge", script_name].iter().collect();
        assert_eq!(info.script_path, expected.to_string_lossy().to_string());
    }

    #[test]
    fn check_run_script_nonexistent_path() {
        // Path that doesn't exist on disk — should still return Ok with exists=false
        let result = check_run_script("/nonexistent/path/to/project".to_string());
        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(!info.exists);
        assert!(info.port > 0);
    }

    #[test]
    fn check_run_script_empty_path() {
        let result = check_run_script(String::new());
        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(!info.exists);
        assert!(info.port > 0);
    }

    #[test]
    fn check_run_script_unique_ports() {
        // Two consecutive calls should return different ports
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        let info1 = check_run_script(path.clone()).unwrap();
        let info2 = check_run_script(path).unwrap();
        assert_ne!(info1.port, info2.port, "Each call should allocate a distinct ephemeral port");
    }
}
