use std::process::Command;

/// Returns the git log for a project as raw lines with ASCII graph decoration.
///
/// Runs `git log --graph --oneline --decorate=short --no-color -n {limit}` in
/// the given project directory. The output is returned as-is (one `String` per
/// line) so the frontend can apply its own styling to the ASCII graph, refs,
/// and commit messages.
#[tauri::command]
pub fn get_git_log(project_path: String, limit: Option<u32>) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(50);

    let output = Command::new("git")
        .args([
            "log",
            "--graph",
            "--oneline",
            "--decorate=short",
            "--no-color",
            &format!("-n{limit}"),
        ])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run git log: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git log failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<String> = stdout.lines().map(String::from).collect();
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Helper: initialise a throwaway git repo with one commit.
    fn init_git_repo(dir: &std::path::Path) {
        Command::new("git")
            .args(["init"])
            .current_dir(dir)
            .output()
            .expect("git init failed");

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(dir)
            .output()
            .expect("git config email failed");

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir)
            .output()
            .expect("git config name failed");

        fs::write(dir.join("file.txt"), "hello").expect("write failed");

        Command::new("git")
            .args(["add", "."])
            .current_dir(dir)
            .output()
            .expect("git add failed");

        Command::new("git")
            .args(["commit", "-m", "initial commit"])
            .current_dir(dir)
            .output()
            .expect("git commit failed");
    }

    #[test]
    fn returns_log_lines_for_valid_repo() {
        let dir = tempfile::tempdir().unwrap();
        init_git_repo(dir.path());

        let result = get_git_log(dir.path().to_string_lossy().to_string(), None);
        assert!(result.is_ok());

        let lines = result.unwrap();
        assert!(!lines.is_empty());
        assert!(lines[0].contains("initial commit"));
    }

    #[test]
    fn respects_limit_parameter() {
        let dir = tempfile::tempdir().unwrap();
        init_git_repo(dir.path());

        // Add a second commit
        fs::write(dir.path().join("file2.txt"), "world").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "second commit"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        let lines = get_git_log(dir.path().to_string_lossy().to_string(), Some(1)).unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("second commit"));
    }

    #[test]
    fn errors_on_non_git_directory() {
        let dir = tempfile::tempdir().unwrap();
        let result = get_git_log(dir.path().to_string_lossy().to_string(), None);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("git log failed"));
    }

    #[test]
    fn errors_on_nonexistent_path() {
        let result = get_git_log("/nonexistent/path/to/project".to_string(), None);
        assert!(result.is_err());
    }
}
