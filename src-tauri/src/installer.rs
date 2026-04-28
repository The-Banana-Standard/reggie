//! Reggie resource installer.
//!
//! Copies (production) or symlinks (dev) bundled `reggie-resources/` into
//! `~/.claude/` on app startup. Tracks an installed version in
//! `~/.claude/.reggie-version` and only re-installs when the bundled version
//! is newer.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Bundled version derived from `Cargo.toml` — matches `tauri.conf.json` and
/// the GitHub release tag.
const BUNDLED_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Subdirectories under `~/.claude/` that Reggie manages.
const CLAUDE_SUBDIRS: &[&str] = &["agents", "commands", "hooks", "docs"];

/// Subdirectories containing `reggie-*` prefixed files where we must not
/// touch user files.
const PREFIXED_DIRS: &[&str] = &["agents", "commands"];

/// The stats hook entry injected into `settings.json`.
const STATS_HOOK_COMMAND: &str =
    "bash ~/.claude/hooks/track-stats.sh \"$TOOL_NAME\" \"$TOOL_INPUT\"";

/// The shell export line for ENABLE_TOOL_SEARCH (bash/zsh).
const SHELL_EXPORT_LINE: &str = "export ENABLE_TOOL_SEARCH=auto:5";

/// The fish shell equivalent.
const FISH_EXPORT_LINE: &str = "set -gx ENABLE_TOOL_SEARCH auto:5";

/// The comment line written above the export, matched verbatim during uninstall.
const REGGIE_COMMENT_LINE: &str = "# Added by Reggie — enables Claude Code auto tool search";

// ── Public types ──────────────────────────────────────────────────────────

/// Returned from `run_install` to summarize what happened.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    /// Whether files were actually installed (false when already up-to-date).
    pub installed: bool,
    /// The version string that is now installed.
    pub version: String,
    /// Whether the first-launch setup UI should be shown.
    pub needs_setup: bool,
    /// Human-readable summary of what happened.
    pub message: String,
}

/// Returned to the frontend by the `get_install_status` command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStatus {
    /// The currently installed version (empty string if none).
    pub version: String,
    /// Whether the first-launch setup UI should be shown.
    pub needs_setup: bool,
}

/// Extended install status with file counts and environment info.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailedInstallStatus {
    /// The currently installed version (empty string if none).
    pub version: String,
    /// The version bundled with this build of the app.
    pub bundled_version: String,
    /// Whether the first-launch setup UI should be shown.
    pub needs_setup: bool,
    /// Number of agent files in `~/.claude/agents/`.
    pub agent_count: usize,
    /// Number of command files in `~/.claude/commands/`.
    pub command_count: usize,
    /// Number of hook files in `~/.claude/hooks/`.
    pub hook_count: usize,
    /// Whether `ENABLE_TOOL_SEARCH` is set in the current environment.
    pub tool_search_configured: bool,
}

/// Returned by `uninstall_reggie_files` to summarize what was removed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallReport {
    /// Absolute paths of files that were removed, as display strings.
    pub files_removed: Vec<String>,
    /// Whether the stats hook entry was removed from `settings.json`.
    pub settings_hook_removed: bool,
    /// Whether the shell profile export line was removed.
    pub shell_profile_removed: bool,
    /// Whether any of `.reggie-version` / `.reggie-setup-complete` were removed.
    pub version_file_removed: bool,
    /// Absolute paths of user overlay files preserved (not removed).
    pub overlays_preserved: Vec<String>,
}

// ── Main entry point ──────────────────────────────────────────────────────

/// Run the full install flow. Called from `setup()` in `lib.rs`.
///
/// 1. Ensure `~/.claude/` directory structure exists.
/// 2. Check if the bundled version is newer than what is installed.
/// 3. If newer (or dev mode): install resources.
/// 4. Write `.reggie-version`.
///
/// This function is intentionally infallible from the caller's perspective —
/// install failures are logged but must not prevent the app from launching.
pub fn run_install(app: &AppHandle) -> Result<InstallResult, String> {
    let claude_dir = get_claude_dir()?;
    let is_dev = cfg!(debug_assertions);

    ensure_dirs(&claude_dir)?;

    let needs_install = is_dev || check_version(&claude_dir);

    let (installed, message) = if needs_install {
        let resource_base = get_resource_base(app)?;

        // Install all resource categories. Collect warnings but don't abort.
        let mut warnings: Vec<String> = Vec::new();

        if let Err(e) = install_resources(&resource_base, &claude_dir, is_dev) {
            warnings.push(format!("agents/commands: {e}"));
        }
        if let Err(e) = install_hooks(&resource_base, &claude_dir, is_dev) {
            warnings.push(format!("hooks: {e}"));
        }
        if let Err(e) = install_docs(&resource_base, &claude_dir, is_dev) {
            warnings.push(format!("docs: {e}"));
        }
        if let Err(e) = install_registries(&resource_base, &claude_dir, is_dev) {
            warnings.push(format!("registries: {e}"));
        }
        if let Err(e) = install_standalone(&resource_base, &claude_dir, is_dev) {
            warnings.push(format!("standalone: {e}"));
        }
        if let Err(e) = create_overlay_files(&claude_dir) {
            warnings.push(format!("overlays: {e}"));
        }
        if let Err(e) = configure_settings(&claude_dir) {
            warnings.push(format!("settings: {e}"));
        }

        write_version(&claude_dir, BUNDLED_VERSION)?;

        for w in &warnings {
            eprintln!("[reggie-installer] warning: {w}");
        }

        let msg = if warnings.is_empty() {
            format!("Installed Reggie v{BUNDLED_VERSION}")
        } else {
            format!(
                "Installed Reggie v{BUNDLED_VERSION} with {} warning(s)",
                warnings.len()
            )
        };

        (true, msg)
    } else {
        (false, format!("Reggie v{BUNDLED_VERSION} already installed"))
    };

    let needs_setup = !setup_complete_flag(&claude_dir).exists();

    Ok(InstallResult {
        installed,
        version: BUNDLED_VERSION.to_string(),
        needs_setup,
        message,
    })
}

// ── Tauri commands ────────────────────────────────────────────────────────

/// Returns the current install status for the frontend.
#[tauri::command]
pub fn get_install_status() -> Result<InstallStatus, String> {
    let claude_dir = get_claude_dir()?;
    let version = read_installed_version(&claude_dir).unwrap_or_default();
    let needs_setup = !setup_complete_flag(&claude_dir).exists();
    Ok(InstallStatus {
        version,
        needs_setup,
    })
}

/// Marks first-launch setup as complete so the UI is not shown again.
#[tauri::command]
pub fn complete_setup() -> Result<(), String> {
    let claude_dir = get_claude_dir()?;
    let flag = setup_complete_flag(&claude_dir);
    fs::write(&flag, BUNDLED_VERSION)
        .map_err(|e| format!("Failed to write setup flag: {e}"))?;
    Ok(())
}

/// Appends the appropriate `ENABLE_TOOL_SEARCH` export to the detected shell profile.
///
/// Uses `set -gx` syntax for fish, `export` for bash/zsh. Returns the path that was modified.
#[tauri::command]
pub fn add_to_shell_profile() -> Result<String, String> {
    let profile_path = detect_shell_profile()?;
    let is_fish = profile_path.to_string_lossy().contains("fish");
    let export_line = if is_fish { FISH_EXPORT_LINE } else { SHELL_EXPORT_LINE };

    // Read existing content to check for duplicates.
    let existing = fs::read_to_string(&profile_path).unwrap_or_default();
    if existing.contains("ENABLE_TOOL_SEARCH") {
        return Ok(format!(
            "ENABLE_TOOL_SEARCH already present in {}",
            profile_path.display()
        ));
    }

    // Append with a blank line separator.
    let mut content = String::new();
    if !existing.ends_with('\n') && !existing.is_empty() {
        content.push('\n');
    }
    content.push('\n');
    content.push_str(REGGIE_COMMENT_LINE);
    content.push('\n');
    content.push_str(export_line);
    content.push('\n');

    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&profile_path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(content.as_bytes())
        })
        .map_err(|e| format!("Failed to write to {}: {e}", profile_path.display()))?;

    // Also mark setup as complete.
    let claude_dir = get_claude_dir()?;
    let _ = fs::write(setup_complete_flag(&claude_dir), BUNDLED_VERSION);

    Ok(format!("Added to {}", profile_path.display()))
}

/// Returns the export line for the user to copy to clipboard.
#[tauri::command]
pub fn get_shell_export_line() -> String {
    SHELL_EXPORT_LINE.to_string()
}

/// Returns detailed install status including file counts and environment info.
#[tauri::command]
pub fn get_detailed_install_status() -> Result<DetailedInstallStatus, String> {
    let claude_dir = get_claude_dir()?;
    let version = read_installed_version(&claude_dir).unwrap_or_default();
    let needs_setup = !setup_complete_flag(&claude_dir).exists();

    let agent_count = count_files_in_dir(&claude_dir.join("agents"));
    let command_count = count_files_in_dir(&claude_dir.join("commands"));
    let hook_count = count_files_in_dir(&claude_dir.join("hooks"));
    let tool_search_configured = std::env::var("ENABLE_TOOL_SEARCH").is_ok();

    Ok(DetailedInstallStatus {
        version,
        bundled_version: BUNDLED_VERSION.to_string(),
        needs_setup,
        agent_count,
        command_count,
        hook_count,
        tool_search_configured,
    })
}

/// Forces a reinstall regardless of version match. Returns the install result.
#[tauri::command]
pub fn force_reinstall(app: AppHandle) -> Result<InstallResult, String> {
    let claude_dir = get_claude_dir()?;
    let is_dev = cfg!(debug_assertions);

    ensure_dirs(&claude_dir)?;

    let resource_base = get_resource_base(&app)?;
    let mut warnings: Vec<String> = Vec::new();

    if let Err(e) = install_resources(&resource_base, &claude_dir, is_dev) {
        warnings.push(format!("agents/commands: {e}"));
    }
    if let Err(e) = install_hooks(&resource_base, &claude_dir, is_dev) {
        warnings.push(format!("hooks: {e}"));
    }
    if let Err(e) = install_docs(&resource_base, &claude_dir, is_dev) {
        warnings.push(format!("docs: {e}"));
    }
    if let Err(e) = install_registries(&resource_base, &claude_dir, is_dev) {
        warnings.push(format!("registries: {e}"));
    }
    if let Err(e) = install_standalone(&resource_base, &claude_dir, is_dev) {
        warnings.push(format!("standalone: {e}"));
    }
    if let Err(e) = create_overlay_files(&claude_dir) {
        warnings.push(format!("overlays: {e}"));
    }
    if let Err(e) = configure_settings(&claude_dir) {
        warnings.push(format!("settings: {e}"));
    }

    write_version(&claude_dir, BUNDLED_VERSION)?;

    for w in &warnings {
        eprintln!("[reggie-installer] warning: {w}");
    }

    let message = if warnings.is_empty() {
        format!("Reinstalled Reggie v{BUNDLED_VERSION}")
    } else {
        format!(
            "Reinstalled Reggie v{BUNDLED_VERSION} with {} warning(s)",
            warnings.len()
        )
    };

    let needs_setup = !setup_complete_flag(&claude_dir).exists();

    Ok(InstallResult {
        installed: true,
        version: BUNDLED_VERSION.to_string(),
        needs_setup,
        message,
    })
}

/// Fully reverses every side effect produced by the installer.
///
/// Removes `reggie-*` prefixed files from managed subdirectories, deletes
/// Reggie-owned registry and hook files, surgically removes the stats hook
/// entry from `settings.json`, optionally strips the shell profile export,
/// and drops the version/setup tracking files. Idempotent — running it twice
/// is a no-op on the second call.
///
/// The `remove_shell_profile` flag is opt-in: when `false`, the user's shell
/// profile is left untouched.
#[tauri::command]
pub fn uninstall_reggie_files(
    app: AppHandle,
    remove_shell_profile: bool,
) -> Result<UninstallReport, String> {
    let claude_dir = get_claude_dir()?;
    let bundled_docs = list_bundled_doc_names(&app).unwrap_or_else(|e| {
        eprintln!(
            "uninstall: list_bundled_doc_names failed ({e}); non-prefixed bundled docs will not be removed"
        );
        Vec::new()
    });
    run_uninstall(&claude_dir, remove_shell_profile, &bundled_docs)
}

/// Enumerates filenames under the bundled `docs/` resource directory.
///
/// Used by the uninstaller to know which non-prefixed files in
/// `~/.claude/docs/` originated from the installer bundle, so they can be
/// removed even though they do not carry the `reggie-` prefix.
fn list_bundled_doc_names(app: &AppHandle) -> Result<Vec<String>, String> {
    let base = get_resource_base(app)?;
    let docs_dir = base.join("docs");
    let Ok(entries) = fs::read_dir(&docs_dir) else {
        return Ok(Vec::new());
    };
    Ok(entries
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect())
}

// ── Internal helpers ──────────────────────────────────────────────────────

/// Returns `~/.claude/`.
fn get_claude_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".claude"))
}

/// Returns the base path to bundled resources: `<resource_dir>/reggie-resources/`.
fn get_resource_base(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {e}"))?;
    Ok(base.join("reggie-resources"))
}

/// Creates `~/.claude/` and all required subdirectories.
fn ensure_dirs(claude_dir: &Path) -> Result<(), String> {
    for subdir in CLAUDE_SUBDIRS {
        let dir = claude_dir.join(subdir);
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    }
    Ok(())
}

/// Returns `true` if a (re-)install is needed: no version file, or bundled
/// version is different from the installed one.
fn check_version(claude_dir: &Path) -> bool {
    match read_installed_version(claude_dir) {
        Some(installed) => installed.trim() != BUNDLED_VERSION,
        None => true,
    }
}

/// Reads `~/.claude/.reggie-version`, returning `None` if missing or unreadable.
fn read_installed_version(claude_dir: &Path) -> Option<String> {
    let path = claude_dir.join(".reggie-version");
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

/// Writes the version string to `~/.claude/.reggie-version`.
fn write_version(claude_dir: &Path, version: &str) -> Result<(), String> {
    let path = claude_dir.join(".reggie-version");
    fs::write(&path, version)
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

/// Path to the `~/.claude/.reggie-setup-complete` flag file.
fn setup_complete_flag(claude_dir: &Path) -> PathBuf {
    claude_dir.join(".reggie-setup-complete")
}

/// Counts the number of regular files in a directory. Returns 0 if the
/// directory does not exist or is unreadable.
fn count_files_in_dir(dir: &Path) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| e.path().is_file())
        .count()
}

/// Installs `reggie-*` prefixed files from `agents/` and `commands/`.
///
/// Only touches files starting with `reggie-` — user files are left alone.
fn install_resources(
    resource_base: &Path,
    claude_dir: &Path,
    is_dev: bool,
) -> Result<(), String> {
    for subdir in PREFIXED_DIRS {
        let src_dir = resource_base.join(subdir);
        let dst_dir = claude_dir.join(subdir);

        if !src_dir.is_dir() {
            eprintln!(
                "[reggie-installer] skipping {subdir}: {} not found",
                src_dir.display()
            );
            continue;
        }

        let entries = fs::read_dir(&src_dir)
            .map_err(|e| format!("Failed to read {}: {e}", src_dir.display()))?;

        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();

            // Only touch reggie-* prefixed files.
            if !name.starts_with("reggie-") {
                continue;
            }

            let src = entry.path();
            if !src.is_file() {
                continue;
            }

            let dst = dst_dir.join(&*name);
            install_file(&src, &dst, is_dev)?;
        }
    }
    Ok(())
}

/// Installs all files from `hooks/` (Reggie-owned directory).
fn install_hooks(
    resource_base: &Path,
    claude_dir: &Path,
    is_dev: bool,
) -> Result<(), String> {
    install_all_files_in_dir(resource_base, claude_dir, "hooks", is_dev)
}

/// Installs all files from `docs/` into `~/.claude/docs/`.
fn install_docs(
    resource_base: &Path,
    claude_dir: &Path,
    is_dev: bool,
) -> Result<(), String> {
    install_all_files_in_dir(resource_base, claude_dir, "docs", is_dev)
}

/// Installs registry files from `registries/` into `~/.claude/` root.
fn install_registries(
    resource_base: &Path,
    claude_dir: &Path,
    is_dev: bool,
) -> Result<(), String> {
    let src_dir = resource_base.join("registries");
    if !src_dir.is_dir() {
        eprintln!(
            "[reggie-installer] skipping registries: {} not found",
            src_dir.display()
        );
        return Ok(());
    }

    let entries = fs::read_dir(&src_dir)
        .map_err(|e| format!("Failed to read {}: {e}", src_dir.display()))?;

    for entry in entries.flatten() {
        let src = entry.path();
        if !src.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let dst = claude_dir.join(&file_name);
        install_file(&src, &dst, is_dev)?;
    }
    Ok(())
}

/// Installs standalone files (REGGIE.md) into `~/.claude/` root.
fn install_standalone(
    resource_base: &Path,
    claude_dir: &Path,
    is_dev: bool,
) -> Result<(), String> {
    // REGGIE.md lives in docs/ in the bundle but goes to ~/.claude/ root.
    let src = resource_base.join("docs").join("REGGIE.md");
    if src.is_file() {
        let dst = claude_dir.join("REGGIE.md");
        install_file(&src, &dst, is_dev)?;
    }
    Ok(())
}

/// Creates local overlay files if they don't already exist.
///
/// These files are user-editable and never overwritten by the installer.
fn create_overlay_files(claude_dir: &Path) -> Result<(), String> {
    let overlays = [
        (
            "mcp-registry.local.yaml",
            "# Local MCP registry overrides — this file is yours to edit.\n# Entries here are merged with the Reggie-managed mcp-registry.yaml.\n",
        ),
        (
            "skills-registry.local.yaml",
            "# Local skills registry overrides — this file is yours to edit.\n# Entries here are merged with the Reggie-managed skills-registry.yaml.\n",
        ),
    ];

    for (name, template) in &overlays {
        let path = claude_dir.join(name);
        if !path.exists() {
            fs::write(&path, template)
                .map_err(|e| format!("Failed to create {name}: {e}"))?;
        }
    }
    Ok(())
}

/// Returns true if `entry` is a pre-fix flat-shape stats hook entry, i.e.
/// `{ "type": "command", "command": STATS_HOOK_COMMAND }` sitting directly
/// in `PostToolUse`. This shape is invalid under Claude Code's current schema
/// (each `PostToolUse` entry must have a `hooks` array) and is what older
/// installer versions wrote.
fn is_legacy_flat_stats_entry(entry: &Value) -> bool {
    entry.get("hooks").is_none()
        && entry.get("command").and_then(|c| c.as_str()) == Some(STATS_HOOK_COMMAND)
}

/// Returns true if `entry` is a wrapped-shape stats hook entry —
/// `{ "matcher": ..., "hooks": [ { "command": STATS_HOOK_COMMAND, ... } ] }` —
/// regardless of matcher value.
fn is_wrapped_stats_entry(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .is_some_and(|arr| {
            arr.iter().any(|h| {
                h.get("command").and_then(|c| c.as_str()) == Some(STATS_HOOK_COMMAND)
            })
        })
}

/// Reads, merges, and writes `~/.claude/settings.json`.
///
/// Ensures `hooks.PostToolUse` contains the stats hook entry. If the file is
/// malformed, it is backed up and a fresh default is used.
fn configure_settings(claude_dir: &Path) -> Result<(), String> {
    let settings_path = claude_dir.join("settings.json");

    let mut settings: Value = if settings_path.is_file() {
        let raw = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {e}"))?;

        match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                // Malformed JSON — backup and warn.
                let backup = claude_dir.join("settings.json.bak");
                eprintln!(
                    "[reggie-installer] settings.json is malformed ({e}), backing up to {}",
                    backup.display()
                );
                let _ = fs::copy(&settings_path, &backup);
                Value::Object(serde_json::Map::new())
            }
        }
    } else {
        Value::Object(serde_json::Map::new())
    };

    // Ensure `settings` is an object.
    if !settings.is_object() {
        let backup = claude_dir.join("settings.json.bak");
        eprintln!(
            "[reggie-installer] settings.json root is not an object, backing up to {}",
            backup.display()
        );
        let _ = fs::write(
            &backup,
            serde_json::to_string_pretty(&settings).unwrap_or_default(),
        );
        settings = Value::Object(serde_json::Map::new());
    }

    let obj = settings.as_object_mut().ok_or("settings is not an object")?;

    // Ensure `hooks` key exists.
    if !obj.contains_key("hooks") {
        obj.insert("hooks".to_string(), Value::Object(serde_json::Map::new()));
    }

    let hooks = obj
        .get_mut("hooks")
        .and_then(|v| v.as_object_mut())
        .ok_or("hooks is not an object")?;

    // Ensure `PostToolUse` key exists as an array.
    if !hooks.contains_key("PostToolUse") {
        hooks.insert("PostToolUse".to_string(), Value::Array(Vec::new()));
    }

    let post_tool_use = hooks
        .get_mut("PostToolUse")
        .and_then(|v| v.as_array_mut())
        .ok_or("PostToolUse is not an array")?;

    // Migrate: drop any legacy flat-shape entries written by pre-fix
    // installer versions. Claude Code's current schema requires each
    // PostToolUse entry to have the matcher-wrapped form.
    post_tool_use.retain(|entry| !is_legacy_flat_stats_entry(entry));

    // Build the stats hook entry in the current wrapped shape:
    //   { "matcher": "", "hooks": [ { "type": "command", "command": "..." } ] }
    let stats_entry = serde_json::json!({
        "matcher": "",
        "hooks": [
            {
                "type": "command",
                "command": STATS_HOOK_COMMAND,
            }
        ],
    });

    // Only add if an equivalent wrapped entry isn't already present.
    let already_present = post_tool_use
        .iter()
        .any(is_wrapped_stats_entry);

    if !already_present {
        post_tool_use.push(stats_entry);
    }

    // Write back with pretty printing.
    let formatted = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings.json: {e}"))?;

    fs::write(&settings_path, formatted)
        .map_err(|e| format!("Failed to write settings.json: {e}"))?;

    Ok(())
}

/// Copies or symlinks a single file from `src` to `dst`.
///
/// In dev mode: creates a symlink (removing an existing file/link first).
/// In prod mode: copies the file (overwriting if present).
fn install_file(src: &Path, dst: &Path, is_dev: bool) -> Result<(), String> {
    if is_dev {
        // Remove existing file or symlink so we can create a fresh symlink.
        if dst.exists() || dst.symlink_metadata().is_ok() {
            fs::remove_file(dst)
                .map_err(|e| format!("Failed to remove {}: {e}", dst.display()))?;
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(src, dst)
                .map_err(|e| format!("Failed to symlink {} -> {}: {e}", dst.display(), src.display()))?;
        }
        #[cfg(not(unix))]
        {
            // Fallback for non-Unix (Windows): just copy.
            fs::copy(src, dst)
                .map_err(|e| format!("Failed to copy {} -> {}: {e}", src.display(), dst.display()))?;
        }
    } else {
        fs::copy(src, dst)
            .map_err(|e| format!("Failed to copy {} -> {}: {e}", src.display(), dst.display()))?;
    }
    Ok(())
}

/// Installs all files from `resource_base/<subdir>/` into `claude_dir/<subdir>/`.
fn install_all_files_in_dir(
    resource_base: &Path,
    claude_dir: &Path,
    subdir: &str,
    is_dev: bool,
) -> Result<(), String> {
    let src_dir = resource_base.join(subdir);
    let dst_dir = claude_dir.join(subdir);

    if !src_dir.is_dir() {
        eprintln!(
            "[reggie-installer] skipping {subdir}: {} not found",
            src_dir.display()
        );
        return Ok(());
    }

    fs::create_dir_all(&dst_dir)
        .map_err(|e| format!("Failed to create {}: {e}", dst_dir.display()))?;

    let entries = fs::read_dir(&src_dir)
        .map_err(|e| format!("Failed to read {}: {e}", src_dir.display()))?;

    for entry in entries.flatten() {
        let src = entry.path();
        if !src.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let dst = dst_dir.join(&file_name);
        install_file(&src, &dst, is_dev)?;
    }
    Ok(())
}

/// Detects the user's shell profile file.
///
/// Checks `$SHELL` first, then falls back to common paths.
fn detect_shell_profile() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;

    // Check $SHELL env var.
    if let Ok(shell) = std::env::var("SHELL") {
        if shell.contains("zsh") {
            return Ok(home.join(".zshrc"));
        }
        if shell.contains("bash") {
            // Prefer .bash_profile on macOS, .bashrc on Linux.
            let bash_profile = home.join(".bash_profile");
            if bash_profile.exists() {
                return Ok(bash_profile);
            }
            return Ok(home.join(".bashrc"));
        }
        if shell.contains("fish") {
            return Ok(home.join(".config/fish/config.fish"));
        }
    }

    // Fallback: try common paths.
    let zshrc = home.join(".zshrc");
    if zshrc.exists() {
        return Ok(zshrc);
    }

    let bash_profile = home.join(".bash_profile");
    if bash_profile.exists() {
        return Ok(bash_profile);
    }

    let bashrc = home.join(".bashrc");
    if bashrc.exists() {
        return Ok(bashrc);
    }

    // Default to .zshrc (macOS default shell).
    Ok(home.join(".zshrc"))
}

// ── Uninstall helpers ─────────────────────────────────────────────────────

/// Removes files in `dir` whose file name begins with `prefix`.
///
/// Returns the list of removed paths. If `dir` does not exist, returns an
/// empty vector — this keeps the uninstaller idempotent.
fn remove_prefixed_files(dir: &Path, prefix: &str) -> Result<Vec<PathBuf>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut removed = Vec::new();
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read {}: {e}", dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();

        // Accept regular files and symlinks; dev-mode installs symlinks in.
        let is_file_or_symlink = path.is_file()
            || path
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false);
        if !is_file_or_symlink {
            continue;
        }

        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if !name.starts_with(prefix) {
            continue;
        }

        fs::remove_file(&path)
            .map_err(|e| format!("Failed to remove {}: {e}", path.display()))?;
        removed.push(path);
    }

    Ok(removed)
}

/// Removes the Reggie stats hook from `settings.json` in-place.
///
/// - If the file is missing or unparseable, returns `Ok(false)` (nothing to do).
/// - Creates `settings.json.bak` with the original bytes before rewriting.
/// - Removes the `PostToolUse` key entirely if the filter leaves it empty, and
///   removes the `hooks` key if it becomes empty.
/// - Returns `true` iff a Reggie entry was actually removed.
fn remove_stats_hook_from_settings(settings_path: &Path) -> Result<bool, String> {
    if !settings_path.is_file() {
        return Ok(false);
    }

    let raw = fs::read_to_string(settings_path)
        .map_err(|e| format!("Failed to read settings.json: {e}"))?;

    let mut settings: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            eprintln!(
                "uninstall: settings.json at {} is malformed JSON ({e}); leaving stats hook in place",
                settings_path.display()
            );
            return Ok(false);
        }
    };

    let Some(obj) = settings.as_object_mut() else {
        eprintln!(
            "uninstall: settings.json at {} is not a JSON object; nothing to clean",
            settings_path.display()
        );
        return Ok(false);
    };

    // Walk to hooks.PostToolUse without creating missing keys.
    let Some(hooks_val) = obj.get_mut("hooks") else {
        // No hooks block at all — nothing to remove, not an error condition.
        return Ok(false);
    };
    let Some(hooks) = hooks_val.as_object_mut() else {
        eprintln!(
            "uninstall: settings.json `hooks` is not an object; cannot remove stats hook"
        );
        return Ok(false);
    };
    let Some(post_val) = hooks.get_mut("PostToolUse") else {
        // No PostToolUse — Reggie hook is not present, expected.
        return Ok(false);
    };
    let Some(post_arr) = post_val.as_array_mut() else {
        eprintln!(
            "uninstall: settings.json `hooks.PostToolUse` is not an array; cannot remove stats hook"
        );
        return Ok(false);
    };

    let before = post_arr.len();
    post_arr.retain(|entry| {
        !is_legacy_flat_stats_entry(entry) && !is_wrapped_stats_entry(entry)
    });
    let removed_any = post_arr.len() != before;

    if !removed_any {
        return Ok(false);
    }

    // Clean up empty containers.
    if post_arr.is_empty() {
        hooks.remove("PostToolUse");
    }
    if hooks.is_empty() {
        obj.remove("hooks");
    }

    // Backup the original before writing the mutated version.
    let backup = settings_path.with_extension("json.bak");
    fs::write(&backup, raw.as_bytes())
        .map_err(|e| format!("Failed to write {}: {e}", backup.display()))?;

    let formatted = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings.json: {e}"))?;
    fs::write(settings_path, formatted)
        .map_err(|e| format!("Failed to write settings.json: {e}"))?;

    Ok(true)
}

/// Removes the Reggie-injected shell export line (and its preceding comment
/// line) from a shell profile file.
///
/// Matches both the bash/zsh form (`SHELL_EXPORT_LINE`) and the fish form
/// (`FISH_EXPORT_LINE`). The installer always writes a
/// `# Added by Reggie — enables Claude Code auto tool search` comment line
/// immediately before the export; that comment is removed too.
///
/// Returns `Ok(false)` if the file is missing or contained no matching lines.
fn remove_shell_profile_export(profile_path: &Path) -> Result<bool, String> {
    if !profile_path.is_file() {
        return Ok(false);
    }

    let raw = fs::read_to_string(profile_path)
        .map_err(|e| format!("Failed to read {}: {e}", profile_path.display()))?;

    let comment = REGGIE_COMMENT_LINE;
    let lines: Vec<&str> = raw.lines().collect();
    let mut kept: Vec<&str> = Vec::with_capacity(lines.len());
    let mut removed_any = false;

    for line in &lines {
        let trimmed = line.trim();
        if trimmed == SHELL_EXPORT_LINE || trimmed == FISH_EXPORT_LINE {
            removed_any = true;
            // If the previous kept line is the Reggie comment, drop it too.
            if kept.last().map(|l| l.trim()) == Some(comment) {
                kept.pop();
            }
            continue;
        }
        kept.push(line);
    }

    if !removed_any {
        return Ok(false);
    }

    // Preserve a trailing newline if the original had one.
    let mut out = kept.join("\n");
    if raw.ends_with('\n') {
        out.push('\n');
    }

    fs::write(profile_path, out)
        .map_err(|e| format!("Failed to write {}: {e}", profile_path.display()))?;

    Ok(true)
}

/// Walks `claude_dir` and returns absolute paths of top-level files whose
/// name ends in `.local.yaml` (user overlays that must never be removed).
fn list_local_overlays(claude_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(claude_dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if !path.is_file() {
                return None;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".local.yaml") {
                Some(path)
            } else {
                None
            }
        })
        .collect()
}

/// Removes `path` if it exists (as a file or symlink). Returns `true` if a
/// file was actually removed. Idempotent — missing paths are not an error.
fn remove_file_if_exists(path: &Path) -> Result<bool, String> {
    if !path.is_file() && path.symlink_metadata().is_err() {
        return Ok(false);
    }
    fs::remove_file(path)
        .map_err(|e| format!("Failed to remove {}: {e}", path.display()))?;
    Ok(true)
}

/// Orchestrates the full uninstall. Split out from the `#[tauri::command]`
/// wrapper so that tests can drive it against a temp directory.
///
/// `bundled_docs` is the list of filenames under the installer's bundled
/// `docs/` resource directory. These are removed from `~/.claude/docs/` in
/// addition to any `reggie-*` prefixed files, because the installer copies
/// them by content rather than by prefix.
fn run_uninstall(
    claude_dir: &Path,
    remove_shell_profile: bool,
    bundled_docs: &[String],
) -> Result<UninstallReport, String> {
    let overlays_preserved: Vec<String> = list_local_overlays(claude_dir)
        .into_iter()
        .map(|p| p.display().to_string())
        .collect();

    let mut report = UninstallReport {
        files_removed: Vec::new(),
        settings_hook_removed: false,
        shell_profile_removed: false,
        version_file_removed: false,
        overlays_preserved,
    };

    // 1. Prefixed files in agents/, commands/, docs/.
    for subdir in ["agents", "commands", "docs"] {
        for p in remove_prefixed_files(&claude_dir.join(subdir), "reggie-")? {
            report.files_removed.push(p.display().to_string());
        }
    }

    // 2. Non-prefixed bundled docs copied by install_docs.
    let docs_dir = claude_dir.join("docs");
    for name in bundled_docs {
        let path = docs_dir.join(name);
        if remove_file_if_exists(&path)? {
            report.files_removed.push(path.display().to_string());
        }
    }

    // 3. Standalone Reggie-owned files (REGGIE.md, stats hook, registries).
    let owned_files = [
        claude_dir.join("REGGIE.md"),
        claude_dir.join("hooks").join("track-stats.sh"),
        claude_dir.join("mcp-registry.yaml"),
        claude_dir.join("skills-registry.yaml"),
    ];
    for path in &owned_files {
        if remove_file_if_exists(path)? {
            report.files_removed.push(path.display().to_string());
        }
    }

    // 4. Surgical settings.json hook removal.
    report.settings_hook_removed =
        remove_stats_hook_from_settings(&claude_dir.join("settings.json"))?;

    // 5. Opt-in shell profile removal. Failing to detect the profile should
    //    not abort the rest of the uninstall.
    if remove_shell_profile {
        report.shell_profile_removed = detect_shell_profile()
            .and_then(|p| remove_shell_profile_export(&p))
            .unwrap_or_else(|e| {
                eprintln!("[reggie-uninstaller] shell profile: {e}");
                false
            });
    }

    // 6. Tracking files.
    for name in [".reggie-version", ".reggie-setup-complete"] {
        let path = claude_dir.join(name);
        if remove_file_if_exists(&path)? {
            report.version_file_removed = true;
            report.files_removed.push(path.display().to_string());
        }
    }

    Ok(report)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    // ── ensure_dirs ──

    #[test]
    fn ensure_dirs_creates_all_subdirectories() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join(".claude");

        ensure_dirs(&claude_dir).unwrap();

        for subdir in CLAUDE_SUBDIRS {
            assert!(
                claude_dir.join(subdir).is_dir(),
                "{subdir} should be created"
            );
        }
    }

    #[test]
    fn ensure_dirs_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join(".claude");

        ensure_dirs(&claude_dir).unwrap();
        ensure_dirs(&claude_dir).unwrap();

        for subdir in CLAUDE_SUBDIRS {
            assert!(claude_dir.join(subdir).is_dir());
        }
    }

    // ── check_version ──

    #[test]
    fn check_version_returns_true_when_no_version_file() {
        let tmp = TempDir::new().unwrap();
        assert!(check_version(tmp.path()));
    }

    #[test]
    fn check_version_returns_true_when_version_differs() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".reggie-version"), "0.0.0").unwrap();
        assert!(check_version(tmp.path()));
    }

    #[test]
    fn check_version_returns_false_when_version_matches() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".reggie-version"), BUNDLED_VERSION).unwrap();
        assert!(!check_version(tmp.path()));
    }

    #[test]
    fn check_version_handles_trailing_whitespace() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join(".reggie-version"),
            format!("{BUNDLED_VERSION}\n"),
        )
        .unwrap();
        assert!(!check_version(tmp.path()));
    }

    // ── write_version ──

    #[test]
    fn write_version_creates_file() {
        let tmp = TempDir::new().unwrap();
        write_version(tmp.path(), "1.2.3").unwrap();
        let content = fs::read_to_string(tmp.path().join(".reggie-version")).unwrap();
        assert_eq!(content, "1.2.3");
    }

    // ── install_resources (prefixed dirs) ──

    #[test]
    fn install_resources_copies_only_reggie_prefixed_files() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");

        // Set up source files.
        let agents_src = resource_base.join("agents");
        fs::create_dir_all(&agents_src).unwrap();
        File::create(agents_src.join("reggie-test.md")).unwrap();
        File::create(agents_src.join("user-custom.md")).unwrap();

        // Set up destination.
        let agents_dst = claude_dir.join("agents");
        fs::create_dir_all(&agents_dst).unwrap();

        install_resources(&resource_base, &claude_dir, false).unwrap();

        assert!(agents_dst.join("reggie-test.md").exists());
        assert!(!agents_dst.join("user-custom.md").exists());
    }

    #[test]
    fn install_resources_does_not_remove_user_files() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");

        let agents_src = resource_base.join("agents");
        fs::create_dir_all(&agents_src).unwrap();
        File::create(agents_src.join("reggie-agent.md")).unwrap();

        let agents_dst = claude_dir.join("agents");
        fs::create_dir_all(&agents_dst).unwrap();
        // Pre-existing user file.
        let mut user_file = File::create(agents_dst.join("my-agent.md")).unwrap();
        write!(user_file, "user content").unwrap();

        install_resources(&resource_base, &claude_dir, false).unwrap();

        // User file must still exist.
        let content = fs::read_to_string(agents_dst.join("my-agent.md")).unwrap();
        assert_eq!(content, "user content");
    }

    // ── install_hooks ──

    #[test]
    fn install_hooks_copies_all_files() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");

        let hooks_src = resource_base.join("hooks");
        fs::create_dir_all(&hooks_src).unwrap();
        File::create(hooks_src.join("track-stats.sh")).unwrap();

        fs::create_dir_all(claude_dir.join("hooks")).unwrap();

        install_hooks(&resource_base, &claude_dir, false).unwrap();

        assert!(claude_dir.join("hooks").join("track-stats.sh").exists());
    }

    // ── install_registries ──

    #[test]
    fn install_registries_copies_to_claude_root() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");
        fs::create_dir_all(&claude_dir).unwrap();

        let reg_src = resource_base.join("registries");
        fs::create_dir_all(&reg_src).unwrap();
        File::create(reg_src.join("mcp-registry.yaml")).unwrap();
        File::create(reg_src.join("skills-registry.yaml")).unwrap();

        install_registries(&resource_base, &claude_dir, false).unwrap();

        assert!(claude_dir.join("mcp-registry.yaml").exists());
        assert!(claude_dir.join("skills-registry.yaml").exists());
    }

    // ── create_overlay_files ──

    #[test]
    fn create_overlay_files_creates_when_missing() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        create_overlay_files(claude_dir).unwrap();

        assert!(claude_dir.join("mcp-registry.local.yaml").exists());
        assert!(claude_dir.join("skills-registry.local.yaml").exists());
    }

    #[test]
    fn create_overlay_files_does_not_overwrite_existing() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        let overlay = claude_dir.join("mcp-registry.local.yaml");
        fs::write(&overlay, "user content").unwrap();

        create_overlay_files(claude_dir).unwrap();

        let content = fs::read_to_string(&overlay).unwrap();
        assert_eq!(content, "user content");
    }

    // ── configure_settings ──

    #[test]
    fn configure_settings_creates_settings_from_scratch() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        configure_settings(claude_dir).unwrap();

        let content = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();

        let hooks = parsed.get("hooks").unwrap().as_object().unwrap();
        let post_tool_use = hooks.get("PostToolUse").unwrap().as_array().unwrap();
        assert_eq!(post_tool_use.len(), 1);

        let entry = &post_tool_use[0];
        assert_eq!(entry.get("matcher").unwrap().as_str().unwrap(), "");
        let inner = entry.get("hooks").unwrap().as_array().unwrap();
        assert_eq!(inner.len(), 1);
        assert_eq!(
            inner[0].get("command").unwrap().as_str().unwrap(),
            STATS_HOOK_COMMAND
        );
        assert_eq!(inner[0].get("type").unwrap().as_str().unwrap(), "command");
    }

    #[test]
    fn configure_settings_migrates_legacy_flat_entry() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        // Seed settings.json with the broken flat-shape entry that older
        // installer versions wrote. This is what triggered Claude Code's
        // "Expected array, but received undefined" error at startup.
        let existing = serde_json::json!({
            "hooks": {
                "PostToolUse": [
                    {"type": "command", "command": STATS_HOOK_COMMAND}
                ]
            }
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        configure_settings(claude_dir).unwrap();

        let content = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();
        let post_tool_use = parsed["hooks"]["PostToolUse"].as_array().unwrap();

        // Exactly one entry: the wrapped form. The legacy flat entry should
        // have been dropped, not left alongside.
        assert_eq!(post_tool_use.len(), 1);
        assert!(post_tool_use[0].get("hooks").is_some());
        assert_eq!(
            post_tool_use[0].get("matcher").unwrap().as_str().unwrap(),
            ""
        );
    }

    #[test]
    fn configure_settings_leaves_existing_wrapped_entry_untouched() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        // Simulate a user who already has Reggie's hook installed under
        // a non-empty matcher — we should not duplicate it.
        let existing = serde_json::json!({
            "hooks": {
                "PostToolUse": [
                    {
                        "matcher": "Bash",
                        "hooks": [
                            {"type": "command", "command": STATS_HOOK_COMMAND}
                        ]
                    }
                ]
            }
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        configure_settings(claude_dir).unwrap();

        let content = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();
        let post_tool_use = parsed["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool_use.len(), 1, "existing wrapped hook should not duplicate");
        assert_eq!(
            post_tool_use[0].get("matcher").unwrap().as_str().unwrap(),
            "Bash"
        );
    }

    #[test]
    fn configure_settings_preserves_existing_config() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        let existing = serde_json::json!({
            "userSetting": "keep-me",
            "hooks": {
                "PreToolUse": [{"type": "command", "command": "echo pre"}]
            }
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        configure_settings(claude_dir).unwrap();

        let content = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();

        assert_eq!(
            parsed.get("userSetting").unwrap().as_str().unwrap(),
            "keep-me"
        );
        let hooks = parsed.get("hooks").unwrap().as_object().unwrap();
        assert!(hooks.contains_key("PreToolUse"));
        assert!(hooks.contains_key("PostToolUse"));
    }

    #[test]
    fn configure_settings_does_not_duplicate_hook() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        // Run twice.
        configure_settings(claude_dir).unwrap();
        configure_settings(claude_dir).unwrap();

        let content = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();
        let post_tool_use = parsed["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool_use.len(), 1, "hook should not be duplicated");
    }

    #[test]
    fn configure_settings_handles_malformed_json() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        fs::write(claude_dir.join("settings.json"), "not valid json {{{").unwrap();

        configure_settings(claude_dir).unwrap();

        // Should have created a backup.
        assert!(claude_dir.join("settings.json.bak").exists());

        // Should have written valid settings.
        let content = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();
        assert!(parsed.get("hooks").is_some());
    }

    // ── install_file (dev mode symlinks) ──

    #[cfg(unix)]
    #[test]
    fn install_file_creates_symlink_in_dev_mode() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("source.md");
        let dst = tmp.path().join("dest.md");

        fs::write(&src, "content").unwrap();

        install_file(&src, &dst, true).unwrap();

        assert!(dst.symlink_metadata().unwrap().file_type().is_symlink());
        let target = fs::read_link(&dst).unwrap();
        assert_eq!(target, src);
    }

    #[test]
    fn install_file_copies_in_prod_mode() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("source.md");
        let dst = tmp.path().join("dest.md");

        fs::write(&src, "content").unwrap();

        install_file(&src, &dst, false).unwrap();

        assert!(dst.is_file());
        assert_eq!(fs::read_to_string(&dst).unwrap(), "content");
    }

    // ── standalone files ──

    #[test]
    fn install_standalone_copies_reggie_md_to_root() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");
        fs::create_dir_all(&claude_dir).unwrap();

        let docs_src = resource_base.join("docs");
        fs::create_dir_all(&docs_src).unwrap();
        fs::write(docs_src.join("REGGIE.md"), "# Reggie").unwrap();

        install_standalone(&resource_base, &claude_dir, false).unwrap();

        let content = fs::read_to_string(claude_dir.join("REGGIE.md")).unwrap();
        assert_eq!(content, "# Reggie");
    }

    // ── setup flag ──

    #[test]
    fn setup_complete_flag_returns_expected_path() {
        let tmp = TempDir::new().unwrap();
        let flag = setup_complete_flag(tmp.path());
        assert!(flag.ends_with(".reggie-setup-complete"));
    }

    // ── get_shell_export_line ──

    #[test]
    fn export_line_contains_enable_tool_search() {
        assert!(SHELL_EXPORT_LINE.contains("ENABLE_TOOL_SEARCH"));
        assert!(SHELL_EXPORT_LINE.starts_with("export "));
    }

    // ── detect_shell_profile ──

    #[test]
    fn detect_shell_profile_returns_a_path() {
        // This test just verifies the function doesn't error — the actual
        // path depends on the host system.
        let result = detect_shell_profile();
        assert!(result.is_ok());
    }

    // ── read_installed_version ──

    #[test]
    fn read_installed_version_returns_none_when_no_file() {
        let tmp = TempDir::new().unwrap();
        let result = read_installed_version(tmp.path());
        assert!(result.is_none());
    }

    #[test]
    fn read_installed_version_returns_some_when_file_exists() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".reggie-version"), "1.2.3").unwrap();
        let result = read_installed_version(tmp.path());
        assert_eq!(result, Some("1.2.3".to_string()));
    }

    #[test]
    fn read_installed_version_trims_whitespace() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".reggie-version"), "  1.2.3\n  ").unwrap();
        let result = read_installed_version(tmp.path());
        assert_eq!(result, Some("1.2.3".to_string()));
    }

    // ── configure_settings: hooks key as non-object ──

    #[test]
    fn configure_settings_errors_when_hooks_is_non_object() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        // "hooks" is a string instead of an object.
        let settings = serde_json::json!({
            "hooks": "not an object"
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).unwrap(),
        )
        .unwrap();

        let result = configure_settings(claude_dir);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("hooks is not an object"),
            "should report hooks is not an object"
        );
    }

    #[test]
    fn configure_settings_errors_when_hooks_is_number() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        let settings = serde_json::json!({
            "hooks": 42
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).unwrap(),
        )
        .unwrap();

        let result = configure_settings(claude_dir);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("hooks is not an object"));
    }

    // ── configure_settings: root is not an object ──

    #[test]
    fn configure_settings_handles_json_array_root() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        // Root is a JSON array, not an object.
        fs::write(claude_dir.join("settings.json"), "[1, 2, 3]").unwrap();

        configure_settings(claude_dir).unwrap();

        // Should have backed up the malformed root.
        assert!(claude_dir.join("settings.json.bak").exists());
        let backup = fs::read_to_string(claude_dir.join("settings.json.bak")).unwrap();
        assert!(backup.contains("["), "backup should contain the original array");

        // Should have written valid settings with the hook.
        let content = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();
        assert!(parsed.is_object());
        assert!(parsed.get("hooks").is_some());
    }

    #[test]
    fn configure_settings_handles_json_string_root() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        // Root is a JSON string literal.
        fs::write(claude_dir.join("settings.json"), "\"just a string\"").unwrap();

        configure_settings(claude_dir).unwrap();

        assert!(claude_dir.join("settings.json.bak").exists());

        let content = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();
        assert!(parsed.is_object());
        let hooks = parsed.get("hooks").unwrap().as_object().unwrap();
        assert!(hooks.contains_key("PostToolUse"));
    }

    #[test]
    fn configure_settings_preserves_existing_post_tool_use_entries() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        let existing = serde_json::json!({
            "hooks": {
                "PostToolUse": [
                    {"type": "command", "command": "echo user-hook"}
                ]
            }
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        configure_settings(claude_dir).unwrap();

        let content = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();
        let post_tool_use = parsed["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool_use.len(), 2, "should have user hook + stats hook");

        // The existing user hook is in the legacy flat shape; leave it alone.
        let user_hook_preserved = post_tool_use.iter().any(|e| {
            e.get("command").and_then(|c| c.as_str()) == Some("echo user-hook")
        });
        assert!(user_hook_preserved, "user hook preserved");

        // The stats hook we write is wrapped; the command lives at
        // entry.hooks[0].command.
        let stats_hook_added = post_tool_use.iter().any(is_wrapped_stats_entry);
        assert!(stats_hook_added, "stats hook added in wrapped shape");
    }

    #[test]
    fn configure_settings_errors_when_post_tool_use_is_non_array() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        let existing = serde_json::json!({
            "hooks": {
                "PostToolUse": "not an array"
            }
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        let result = configure_settings(claude_dir);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("PostToolUse is not an array"),
            "error should mention PostToolUse"
        );
    }

    // ── install_standalone: REGGIE.md missing from resources ──

    #[test]
    fn install_standalone_succeeds_when_reggie_md_missing() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");
        fs::create_dir_all(&claude_dir).unwrap();

        // docs/ dir exists but REGGIE.md does not.
        fs::create_dir_all(resource_base.join("docs")).unwrap();

        let result = install_standalone(&resource_base, &claude_dir, false);
        assert!(result.is_ok(), "should succeed gracefully when REGGIE.md is absent");
        assert!(!claude_dir.join("REGGIE.md").exists());
    }

    #[test]
    fn install_standalone_succeeds_when_docs_dir_missing() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");
        fs::create_dir_all(&claude_dir).unwrap();

        // resource_base exists but docs/ subdirectory does not.
        fs::create_dir_all(&resource_base).unwrap();

        let result = install_standalone(&resource_base, &claude_dir, false);
        assert!(result.is_ok(), "should succeed gracefully when docs/ dir is absent");
        assert!(!claude_dir.join("REGGIE.md").exists());
    }

    // ── install_all_files_in_dir: source directory missing ──

    #[test]
    fn install_all_files_in_dir_succeeds_when_source_missing() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");

        // Neither resource_base nor its subdir exist.
        let result = install_all_files_in_dir(&resource_base, &claude_dir, "docs", false);
        assert!(
            result.is_ok(),
            "should return Ok when source directory does not exist"
        );
        // Destination should not be created either.
        assert!(!claude_dir.join("docs").exists());
    }

    // ── install_docs ──

    #[test]
    fn install_docs_copies_all_doc_files() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");

        let docs_src = resource_base.join("docs");
        fs::create_dir_all(&docs_src).unwrap();
        fs::write(docs_src.join("patterns.md"), "# Patterns").unwrap();
        fs::write(docs_src.join("data-models.md"), "# Data Models").unwrap();

        install_docs(&resource_base, &claude_dir, false).unwrap();

        assert!(claude_dir.join("docs").join("patterns.md").exists());
        assert!(claude_dir.join("docs").join("data-models.md").exists());

        let content = fs::read_to_string(claude_dir.join("docs").join("patterns.md")).unwrap();
        assert_eq!(content, "# Patterns");
    }

    #[test]
    fn install_docs_succeeds_when_docs_dir_missing() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");

        // No docs/ directory in resources.
        fs::create_dir_all(&resource_base).unwrap();

        let result = install_docs(&resource_base, &claude_dir, false);
        assert!(result.is_ok());
    }

    // ── install_file: overwrite in prod mode ──

    #[test]
    fn install_file_overwrites_existing_in_prod_mode() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("source.md");
        let dst = tmp.path().join("dest.md");

        fs::write(&dst, "old content").unwrap();
        fs::write(&src, "new content").unwrap();

        install_file(&src, &dst, false).unwrap();

        let content = fs::read_to_string(&dst).unwrap();
        assert_eq!(content, "new content", "prod mode should overwrite existing file");
    }

    // ── install_file: dev mode replaces existing symlink ──

    #[cfg(unix)]
    #[test]
    fn install_file_replaces_existing_symlink_in_dev_mode() {
        let tmp = TempDir::new().unwrap();
        let src_old = tmp.path().join("old_source.md");
        let src_new = tmp.path().join("new_source.md");
        let dst = tmp.path().join("dest.md");

        fs::write(&src_old, "old").unwrap();
        fs::write(&src_new, "new").unwrap();

        // Create initial symlink.
        install_file(&src_old, &dst, true).unwrap();
        assert_eq!(fs::read_link(&dst).unwrap(), src_old);

        // Replace with new symlink.
        install_file(&src_new, &dst, true).unwrap();
        assert_eq!(fs::read_link(&dst).unwrap(), src_new);
        assert_eq!(fs::read_to_string(&dst).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn install_file_replaces_regular_file_with_symlink_in_dev_mode() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("source.md");
        let dst = tmp.path().join("dest.md");

        fs::write(&src, "source content").unwrap();
        fs::write(&dst, "regular file content").unwrap();

        // Destination is a regular file; dev mode should replace it with a symlink.
        install_file(&src, &dst, true).unwrap();

        assert!(dst.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(fs::read_link(&dst).unwrap(), src);
    }

    // ── install_resources: both agents and commands ──

    #[test]
    fn install_resources_processes_both_agents_and_commands() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");

        // Set up agents and commands source directories.
        let agents_src = resource_base.join("agents");
        let commands_src = resource_base.join("commands");
        fs::create_dir_all(&agents_src).unwrap();
        fs::create_dir_all(&commands_src).unwrap();
        fs::write(agents_src.join("reggie-agent.md"), "agent").unwrap();
        fs::write(commands_src.join("reggie-cmd.md"), "command").unwrap();

        // Set up destination directories.
        fs::create_dir_all(claude_dir.join("agents")).unwrap();
        fs::create_dir_all(claude_dir.join("commands")).unwrap();

        install_resources(&resource_base, &claude_dir, false).unwrap();

        assert!(claude_dir.join("agents").join("reggie-agent.md").exists());
        assert!(claude_dir.join("commands").join("reggie-cmd.md").exists());
    }

    // ── install_resources: source dir missing is not an error ──

    #[test]
    fn install_resources_skips_missing_source_dirs() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");

        // resource_base doesn't even exist — agents/ and commands/ are missing.
        fs::create_dir_all(&claude_dir).unwrap();

        let result = install_resources(&resource_base, &claude_dir, false);
        assert!(result.is_ok(), "should skip missing source dirs gracefully");
    }

    // ── install_registries: source dir missing ──

    #[test]
    fn install_registries_skips_when_source_missing() {
        let tmp = TempDir::new().unwrap();
        let resource_base = tmp.path().join("resources");
        let claude_dir = tmp.path().join("claude");
        fs::create_dir_all(&claude_dir).unwrap();

        let result = install_registries(&resource_base, &claude_dir, false);
        assert!(result.is_ok(), "should skip gracefully when registries dir is missing");
    }

    // ── configure_settings: hooks as array ──

    #[test]
    fn configure_settings_errors_when_hooks_is_array() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        let settings = serde_json::json!({
            "hooks": [1, 2, 3]
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).unwrap(),
        )
        .unwrap();

        let result = configure_settings(claude_dir);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("hooks is not an object"));
    }

    // ── count_files_in_dir ──

    #[test]
    fn count_files_in_dir_returns_zero_for_missing_dir() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("nonexistent");
        assert_eq!(count_files_in_dir(&missing), 0);
    }

    #[test]
    fn count_files_in_dir_returns_zero_for_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("empty");
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(count_files_in_dir(&dir), 0);
    }

    #[test]
    fn count_files_in_dir_counts_only_files() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("mixed");
        fs::create_dir_all(&dir).unwrap();

        File::create(dir.join("file1.md")).unwrap();
        File::create(dir.join("file2.md")).unwrap();
        fs::create_dir_all(dir.join("subdir")).unwrap();

        assert_eq!(count_files_in_dir(&dir), 2);
    }

    #[test]
    fn count_files_in_dir_does_not_recurse() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("nested");
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();

        File::create(dir.join("top.md")).unwrap();
        File::create(sub.join("nested.md")).unwrap();

        // Only the top-level file should be counted.
        assert_eq!(count_files_in_dir(&dir), 1);
    }

    // ── remove_prefixed_files ──

    #[test]
    fn remove_prefixed_files_only_removes_matching_prefix() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        File::create(dir.join("reggie-a.md")).unwrap();
        File::create(dir.join("reggie-b.md")).unwrap();
        File::create(dir.join("user-custom.md")).unwrap();

        let removed = remove_prefixed_files(dir, "reggie-").unwrap();
        assert_eq!(removed.len(), 2, "should remove both reggie-* files");
        assert!(!dir.join("reggie-a.md").exists());
        assert!(!dir.join("reggie-b.md").exists());
        assert!(
            dir.join("user-custom.md").exists(),
            "user file must be preserved"
        );
    }

    #[test]
    fn remove_prefixed_files_handles_missing_dir() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("nope");
        let removed = remove_prefixed_files(&missing, "reggie-").unwrap();
        assert!(removed.is_empty());
    }

    // ── remove_stats_hook_from_settings ──

    #[test]
    fn remove_stats_hook_preserves_other_hooks() {
        let tmp = TempDir::new().unwrap();
        let settings_path = tmp.path().join("settings.json");

        let existing = serde_json::json!({
            "hooks": {
                "PostToolUse": [
                    {"type": "command", "command": STATS_HOOK_COMMAND},
                    {"type": "command", "command": "echo user-hook"}
                ]
            }
        });
        fs::write(&settings_path, serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        let removed = remove_stats_hook_from_settings(&settings_path).unwrap();
        assert!(removed);

        let parsed: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        let post_tool_use = parsed["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool_use.len(), 1);
        assert_eq!(
            post_tool_use[0].get("command").unwrap().as_str().unwrap(),
            "echo user-hook"
        );

        assert!(
            tmp.path().join("settings.json.bak").exists(),
            "backup must be created"
        );
    }

    #[test]
    fn remove_stats_hook_removes_empty_posttooluse_key() {
        let tmp = TempDir::new().unwrap();
        let settings_path = tmp.path().join("settings.json");

        let existing = serde_json::json!({
            "hooks": {
                "PostToolUse": [
                    {"type": "command", "command": STATS_HOOK_COMMAND}
                ]
            }
        });
        fs::write(&settings_path, serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        let removed = remove_stats_hook_from_settings(&settings_path).unwrap();
        assert!(removed);

        let parsed: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        let obj = parsed.as_object().unwrap();
        // PostToolUse should be gone, and since hooks was the only key and
        // it is now empty, hooks should also be gone.
        assert!(
            !obj.contains_key("hooks"),
            "empty hooks object should be removed"
        );
    }

    #[test]
    fn remove_stats_hook_preserves_unrelated_top_level_keys() {
        let tmp = TempDir::new().unwrap();
        let settings_path = tmp.path().join("settings.json");

        let existing = serde_json::json!({
            "userSetting": "keep-me",
            "hooks": {
                "PostToolUse": [
                    {"type": "command", "command": STATS_HOOK_COMMAND}
                ]
            }
        });
        fs::write(&settings_path, serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        remove_stats_hook_from_settings(&settings_path).unwrap();

        let parsed: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(
            parsed.get("userSetting").unwrap().as_str().unwrap(),
            "keep-me"
        );
    }

    #[test]
    fn remove_stats_hook_idempotent() {
        let tmp = TempDir::new().unwrap();
        let settings_path = tmp.path().join("settings.json");

        let existing = serde_json::json!({
            "hooks": {
                "PostToolUse": [
                    {"type": "command", "command": STATS_HOOK_COMMAND}
                ]
            }
        });
        fs::write(&settings_path, serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        let first = remove_stats_hook_from_settings(&settings_path).unwrap();
        let second = remove_stats_hook_from_settings(&settings_path).unwrap();
        assert!(first);
        assert!(!second, "second call should be a no-op");
    }

    #[test]
    fn remove_stats_hook_removes_wrapped_entry() {
        let tmp = TempDir::new().unwrap();
        let settings_path = tmp.path().join("settings.json");

        // Wrapped shape (current installer output).
        let existing = serde_json::json!({
            "hooks": {
                "PostToolUse": [
                    {
                        "matcher": "",
                        "hooks": [
                            {"type": "command", "command": STATS_HOOK_COMMAND}
                        ]
                    },
                    {"type": "command", "command": "echo user-hook"}
                ]
            }
        });
        fs::write(&settings_path, serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        let removed = remove_stats_hook_from_settings(&settings_path).unwrap();
        assert!(removed);

        let parsed: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        let post_tool_use = parsed["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool_use.len(), 1);
        assert_eq!(
            post_tool_use[0].get("command").unwrap().as_str().unwrap(),
            "echo user-hook"
        );
    }

    #[test]
    fn remove_stats_hook_missing_file() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("nope.json");
        let result = remove_stats_hook_from_settings(&missing).unwrap();
        assert!(!result);
    }

    // ── remove_shell_profile_export ──

    #[test]
    fn remove_shell_profile_export_removes_line_and_comment() {
        let tmp = TempDir::new().unwrap();
        let profile = tmp.path().join(".zshrc");
        let original = "\
export PATH=/usr/local/bin
# Added by Reggie — enables Claude Code auto tool search
export ENABLE_TOOL_SEARCH=auto:5
";
        fs::write(&profile, original).unwrap();

        let removed = remove_shell_profile_export(&profile).unwrap();
        assert!(removed);

        let after = fs::read_to_string(&profile).unwrap();
        assert!(after.contains("export PATH=/usr/local/bin"));
        assert!(!after.contains("ENABLE_TOOL_SEARCH"));
        assert!(
            !after.contains("Added by Reggie"),
            "preceding comment should be removed"
        );
    }

    #[test]
    fn remove_shell_profile_export_preserves_unrelated() {
        let tmp = TempDir::new().unwrap();
        let profile = tmp.path().join(".zshrc");
        let original = "\
export PATH=/usr/local/bin
alias ll='ls -la'
";
        fs::write(&profile, original).unwrap();

        let removed = remove_shell_profile_export(&profile).unwrap();
        assert!(!removed);

        let after = fs::read_to_string(&profile).unwrap();
        assert_eq!(after, original);
    }

    #[test]
    fn remove_shell_profile_export_handles_fish_line() {
        let tmp = TempDir::new().unwrap();
        let profile = tmp.path().join("config.fish");
        let original = "\
# Added by Reggie — enables Claude Code auto tool search
set -gx ENABLE_TOOL_SEARCH auto:5
";
        fs::write(&profile, original).unwrap();

        let removed = remove_shell_profile_export(&profile).unwrap();
        assert!(removed);

        let after = fs::read_to_string(&profile).unwrap();
        assert!(!after.contains("ENABLE_TOOL_SEARCH"));
        assert!(!after.contains("Added by Reggie"));
    }

    #[test]
    fn remove_shell_profile_export_missing_file() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("nope.rc");
        let removed = remove_shell_profile_export(&missing).unwrap();
        assert!(!removed);
    }

    // ── run_uninstall orchestrator ──

    #[test]
    fn run_uninstall_removes_prefixed_files_and_preserves_overlays() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();

        fs::create_dir_all(claude_dir.join("agents")).unwrap();
        fs::create_dir_all(claude_dir.join("commands")).unwrap();
        fs::create_dir_all(claude_dir.join("docs")).unwrap();
        fs::create_dir_all(claude_dir.join("hooks")).unwrap();

        File::create(claude_dir.join("agents").join("reggie-one.md")).unwrap();
        File::create(claude_dir.join("agents").join("user-agent.md")).unwrap();
        File::create(claude_dir.join("commands").join("reggie-cmd.md")).unwrap();
        File::create(claude_dir.join("commands").join("user-cmd.md")).unwrap();
        File::create(claude_dir.join("docs").join("reggie-doc.md")).unwrap();
        File::create(claude_dir.join("docs").join("user-doc.md")).unwrap();
        fs::write(claude_dir.join("REGGIE.md"), "# Reggie").unwrap();
        fs::write(claude_dir.join("hooks").join("track-stats.sh"), "#!/bin/sh\n").unwrap();
        fs::write(claude_dir.join("mcp-registry.yaml"), "registry").unwrap();
        fs::write(claude_dir.join("skills-registry.yaml"), "registry").unwrap();
        fs::write(claude_dir.join("mcp-registry.local.yaml"), "user overlay").unwrap();
        fs::write(claude_dir.join("skills-registry.local.yaml"), "user overlay").unwrap();
        fs::write(claude_dir.join(".reggie-version"), "1.0.0").unwrap();
        fs::write(claude_dir.join(".reggie-setup-complete"), "1.0.0").unwrap();

        let report = run_uninstall(claude_dir, false, &[]).unwrap();

        // Prefixed files removed.
        assert!(!claude_dir.join("agents").join("reggie-one.md").exists());
        assert!(!claude_dir.join("commands").join("reggie-cmd.md").exists());
        assert!(!claude_dir.join("docs").join("reggie-doc.md").exists());

        // User files preserved.
        assert!(claude_dir.join("agents").join("user-agent.md").exists());
        assert!(claude_dir.join("commands").join("user-cmd.md").exists());
        assert!(claude_dir.join("docs").join("user-doc.md").exists());

        // Standalone and managed files removed.
        assert!(!claude_dir.join("REGGIE.md").exists());
        assert!(!claude_dir.join("hooks").join("track-stats.sh").exists());
        assert!(!claude_dir.join("mcp-registry.yaml").exists());
        assert!(!claude_dir.join("skills-registry.yaml").exists());

        // Overlays preserved on disk AND reported.
        assert!(claude_dir.join("mcp-registry.local.yaml").exists());
        assert!(claude_dir.join("skills-registry.local.yaml").exists());
        assert_eq!(report.overlays_preserved.len(), 2);

        // Tracking files removed.
        assert!(!claude_dir.join(".reggie-version").exists());
        assert!(!claude_dir.join(".reggie-setup-complete").exists());
        assert!(report.version_file_removed);

        // Shell profile was NOT touched (opt-in flag was false).
        assert!(!report.shell_profile_removed);
    }

    #[test]
    fn run_uninstall_removes_bundled_non_prefixed_docs() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();
        fs::create_dir_all(claude_dir.join("docs")).unwrap();

        // Real filenames from resources/docs/ that the installer copies.
        fs::write(claude_dir.join("docs").join("PORTABLE-PACKAGE.md"), "bundled").unwrap();
        fs::write(claude_dir.join("docs").join("agents-is-all-you-need.md"), "bundled").unwrap();
        fs::write(claude_dir.join("docs").join("reggie-quickstart.md"), "bundled").unwrap();
        // A file the user wrote themselves — must survive.
        fs::write(claude_dir.join("docs").join("my-notes.md"), "mine").unwrap();

        let bundled = vec![
            "PORTABLE-PACKAGE.md".to_string(),
            "agents-is-all-you-need.md".to_string(),
            "reggie-quickstart.md".to_string(),
            "REGGIE.md".to_string(),
        ];
        let report = run_uninstall(claude_dir, false, &bundled).unwrap();

        assert!(!claude_dir.join("docs").join("PORTABLE-PACKAGE.md").exists());
        assert!(!claude_dir.join("docs").join("agents-is-all-you-need.md").exists());
        assert!(!claude_dir.join("docs").join("reggie-quickstart.md").exists());
        assert!(claude_dir.join("docs").join("my-notes.md").exists());
        // REGGIE.md was in the bundled list but not on disk — must not error.
        assert!(report
            .files_removed
            .iter()
            .any(|p| p.ends_with("PORTABLE-PACKAGE.md")));
    }

    #[test]
    fn run_uninstall_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path();
        fs::create_dir_all(claude_dir.join("agents")).unwrap();
        File::create(claude_dir.join("agents").join("reggie-one.md")).unwrap();

        run_uninstall(claude_dir, false, &[]).unwrap();
        // Second call must not error even though nothing is left to remove.
        let second = run_uninstall(claude_dir, false, &[]).unwrap();
        assert!(second.files_removed.is_empty());
        assert!(!second.settings_hook_removed);
        assert!(!second.version_file_removed);
    }
}
