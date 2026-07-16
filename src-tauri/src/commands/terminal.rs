use crate::state::{AppState, HeadlessTerminal};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Instant;
use tauri::{ipc::Channel, AppHandle, Emitter, State};

const MAX_HEADLESS_BUFFER: usize = 2 * 1024 * 1024; // 2MB

/// Strip ASCII control bytes (< 0x20) from a command string before writing to
/// the PTY. Belt-and-suspenders against CR-injection from any code path that
/// bypasses the slug validator. The trailing `\r` written separately is the
/// legitimate submission signal and is not affected.
fn strip_control_chars(s: &str) -> String {
    s.chars().filter(|&c| c as u32 >= 0x20).collect()
}

const ALLOWED_MODELS: &[&str] = &["opus", "sonnet", "haiku"];
const ALLOWED_EFFORTS: &[&str] = &["high", "medium", "low"];

fn validate_model(model: &Option<String>) -> Result<(), String> {
    if let Some(ref m) = model {
        if !ALLOWED_MODELS.contains(&m.as_str()) {
            return Err(format!("Invalid model: {}", m));
        }
    }
    Ok(())
}

fn validate_effort(effort: &Option<String>) -> Result<(), String> {
    if let Some(ref e) = effort {
        if !ALLOWED_EFFORTS.contains(&e.as_str()) {
            return Err(format!("Invalid effort: {}", e));
        }
    }
    Ok(())
}

/// Reject implausibly small terminal dimensions. A real terminal is at least
/// 20 cols × 5 rows; smaller values are almost always a frontend bug
/// (e.g. fitAddon measuring a hidden container — see
/// .pipeline/fix-sessions-tab-width-on-return/HANDOFF.md). Rejecting here
/// prevents the PTY from being reflowed narrow, which causes permanent
/// buffer corruption when the TUI redraws with hard newlines.
fn validate_pty_size(rows: u16, cols: u16) -> Result<(), String> {
    if cols < 20 || rows < 5 {
        return Err(format!(
            "Refusing implausibly small PTY size: rows={}, cols={}",
            rows, cols
        ));
    }
    Ok(())
}

fn configure_env(cmd: &mut CommandBuilder) {
    let full_path = ensure_full_path();
    cmd.env_clear();
    for (key, value) in std::env::vars() {
        if key.starts_with("CLAUDECODE") || key.starts_with("CLAUDE_CODE") || key == "PATH" {
            continue;
        }
        cmd.env(key, value);
    }
    cmd.env("PATH", &full_path);
    cmd.env("TERM", "xterm-256color");
}

/// Ensure PATH includes common locations where CLI tools are installed.
/// macOS apps launched from Finder/Dock get a minimal PATH that typically
/// excludes directories like ~/.local/bin, ~/.cargo/bin, /usr/local/bin,
/// and nvm/fnm/Homebrew paths where `claude` may be installed.
pub(crate) fn ensure_full_path() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();

    let extra_dirs = [
        format!("{}/.local/bin", home),
        format!("{}/.cargo/bin", home),
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        format!("{}/.nvm/versions/node", home), // nvm — we'll glob below
        format!("{}/.fnm/aliases/default/bin", home),
        format!("{}/Library/Application Support/fnm/aliases/default/bin", home),
    ];

    let mut paths: Vec<String> = current_path.split(':').map(|s| s.to_string()).collect();

    for dir in &extra_dirs {
        if !paths.contains(dir) && std::path::Path::new(dir).exists() {
            paths.push(dir.clone());
        }
    }

    // Also pick up the latest nvm node version if available
    let nvm_dir = format!("{}/.nvm/versions/node", home);
    if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
        let mut versions: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        versions.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
        if let Some(latest) = versions.first() {
            let bin = latest.path().join("bin");
            let bin_str = bin.to_string_lossy().to_string();
            if !paths.contains(&bin_str) && bin.exists() {
                paths.push(bin_str);
            }
        }
    }

    paths.join(":")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub available: bool,
    pub path: Option<String>,
}

fn check_cli(binary: &str) -> CliStatus {
    let full_path = ensure_full_path();
    let lookup_command = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    match std::process::Command::new(lookup_command)
        .arg(binary)
        .env("PATH", &full_path)
        .output()
    {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            CliStatus {
                available: true,
                path: Some(path),
            }
        }
        _ => CliStatus {
            available: false,
            path: None,
        },
    }
}

#[tauri::command]
pub fn check_claude_cli() -> CliStatus {
    check_cli("claude")
}

#[tauri::command]
pub fn check_codex_cli() -> CliStatus {
    check_cli("codex")
}

fn terminal_program(
    is_claude_session: bool,
    is_codex_session: bool,
) -> Result<&'static str, String> {
    match (is_claude_session, is_codex_session) {
        (true, true) => Err("A terminal cannot be both a Claude and Codex session".to_string()),
        (true, false) => Ok("claude"),
        (false, true) => Ok("codex"),
        (false, false) => Ok("shell"),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum TerminalEvent {
    Output { data: Vec<u8> },
    Exit { code: Option<i32> },
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn spawn_terminal(
    state: State<'_, AppState>,
    project_path: String,
    is_claude_session: bool,
    is_codex_session: bool,
    session_id: Option<String>,
    initial_command: Option<String>,
    system_prompt: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    on_event: Channel<TerminalEvent>,
) -> Result<String, String> {
    let program = terminal_program(is_claude_session, is_codex_session)?;
    validate_model(&model)?;
    validate_effort(&effort)?;

    let terminal_id = uuid::Uuid::new_v4().to_string();

    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = if program == "claude" {
        let mut c = CommandBuilder::new("claude");
        if let Some(ref m) = model {
            c.arg("--model");
            c.arg(m);
        }
        if let Some(ref e) = effort {
            c.arg("--effort");
            c.arg(e);
        }
        if let Some(ref sid) = session_id {
            c.arg("--resume");
            c.arg(sid);
        }
        // Pass system prompt as CLI arg — invisible to the user
        if let Some(ref sp) = system_prompt {
            c.arg("--system-prompt");
            c.arg(sp);
        }
        c
    } else if program == "codex" {
        CommandBuilder::new("codex")
    } else {
        let shell = if cfg!(target_os = "windows") {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        };
        CommandBuilder::new(shell)
    };

    cmd.cwd(&project_path);
    configure_env(&mut cmd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store terminal instance
    {
        let mut terminals = state.terminals.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        terminals.insert(
            terminal_id.clone(),
            crate::state::TerminalInstance {
                master: pair.master,
                writer,
                child,
                project_path: project_path.clone(),
                is_claude_session,
                is_codex_session,
            },
        );
    }

    // Spawn reader thread
    let tid = terminal_id.clone();
    let terminals_ref = Arc::clone(&state.terminals);
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = on_event.send(TerminalEvent::Output {
                        data: buf[..n].to_vec(),
                    });
                }
                Err(_) => break,
            }
        }
        // Get real exit code from child process
        let exit_code = if let Ok(mut terminals) = terminals_ref.lock() {
            if let Some(mut term) = terminals.remove(&tid) {
                term.child
                    .wait()
                    .ok()
                    .map(|status| status.exit_code() as i32)
            } else {
                None
            }
        } else {
            None
        };
        let _ = on_event.send(TerminalEvent::Exit { code: exit_code });
    });

    // Send initial command after a delay if provided
    if let Some(cmd) = initial_command {
        let tid2 = terminal_id.clone();
        let terminals_ref2 = Arc::clone(&state.terminals);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(2000));
            let Ok(mut terminals) = terminals_ref2.lock() else { return };
            if let Some(term) = terminals.get_mut(&tid2) {
                let safe_cmd = strip_control_chars(&cmd);
                let _ = term.writer.write_all(safe_cmd.as_bytes());
                let _ = term.writer.write_all(b"\r");
                let _ = term.writer.flush();
            }
        });
    }

    Ok(terminal_id)
}

#[tauri::command]
pub fn write_to_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(term) = terminals.get_mut(&terminal_id) {
        term.writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        term.writer
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    } else {
        Err("Terminal not found".to_string())
    }
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    validate_pty_size(rows, cols)?;
    let terminals = state.terminals.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(term) = terminals.get(&terminal_id) {
        term.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
        Ok(())
    } else {
        Err("Terminal not found".to_string())
    }
}

#[tauri::command]
pub fn close_terminal(state: State<'_, AppState>, terminal_id: String) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    // Just removing it will drop the master PTY which signals the child
    terminals.remove(&terminal_id);
    Ok(())
}

// ── Headless terminal commands ──

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadlessTerminalStatus {
    pub terminal_id: String,
    pub needs_attention: bool,
    pub exited: bool,
    pub exit_code: Option<i32>,
    pub buffer_size: usize,
    pub completed: bool,
}

#[tauri::command]
pub fn spawn_headless_terminal(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    project_path: String,
    initial_command: Option<String>,
    model: Option<String>,
    effort: Option<String>,
) -> Result<String, String> {
    validate_model(&model)?;
    validate_effort(&effort)?;

    let terminal_id = uuid::Uuid::new_v4().to_string();

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Headless terminals always launch claude
    let mut cmd = CommandBuilder::new("claude");
    if let Some(ref m) = model {
        cmd.arg("--model");
        cmd.arg(m);
    }
    if let Some(ref e) = effort {
        cmd.arg("--effort");
        cmd.arg(e);
    }

    cmd.cwd(&project_path);
    configure_env(&mut cmd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store headless terminal
    {
        let mut headless = state
            .headless_terminals
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;
        headless.insert(
            terminal_id.clone(),
            HeadlessTerminal {
                master: pair.master,
                writer,
                child,
                project_path: project_path.clone(),
                output_buffer: Vec::new(),
                last_output_time: Instant::now(),
                live_channel: None,
                exited: false,
                exit_code: None,
                completed: false,
            },
        );
    }

    // Spawn reader thread that buffers output
    let tid = terminal_id.clone();
    let headless_ref = Arc::clone(&state.headless_terminals);
    let app_for_reader = app_handle.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut was_needs_attention = false;
        let mut tail_buf: Vec<u8> = Vec::new(); // Last 100 bytes for cross-chunk marker detection
        let mut already_completed = false;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();

                    // Detect completion markers across chunk boundaries
                    let mut detected_completed = false;
                    let mut detected_failed = false;
                    if !already_completed {
                        let mut scan_buf = tail_buf.clone();
                        scan_buf.extend_from_slice(&data);
                        let scan_str = String::from_utf8_lossy(&scan_buf);
                        if let Some(start) = scan_str.find("~~REGGIE:DONE:") {
                            let rest = &scan_str[start + 14..]; // skip "~~REGGIE:DONE:"
                            if let Some(end) = rest.find("~~") {
                                let inner = &rest[..end]; // "command:status"
                                if let Some(colon) = inner.rfind(':') {
                                    let status = &inner[colon + 1..];
                                    if status == "success" {
                                        detected_completed = true;
                                    } else if status == "failed" {
                                        detected_failed = true;
                                    }
                                }
                            }
                        }
                        // Update tail buffer: keep last 256 bytes to accommodate long command names in markers
                        tail_buf.extend_from_slice(&data);
                        if tail_buf.len() > 256 {
                            let excess = tail_buf.len() - 256;
                            tail_buf.drain(..excess);
                        }
                    }

                    if let Ok(mut headless) = headless_ref.lock() {
                        if let Some(term) = headless.get_mut(&tid) {
                            term.output_buffer.extend_from_slice(&data);
                            // Cap buffer: keep only the tail when exceeding max
                            if term.output_buffer.len() > MAX_HEADLESS_BUFFER {
                                let excess = term.output_buffer.len() - MAX_HEADLESS_BUFFER;
                                term.output_buffer.drain(..excess);
                            }
                            term.last_output_time = Instant::now();

                            // Forward to live channel if attached
                            if let Some(ref channel) = term.live_channel {
                                let _ = channel.send(TerminalEvent::Output {
                                    data: data.clone(),
                                });
                            }

                            // Handle completion marker detection
                            if detected_completed {
                                already_completed = true;
                                term.completed = true;
                                let _ = app_for_reader.emit(
                                    "headless-terminal-status",
                                    HeadlessTerminalStatus {
                                        terminal_id: tid.clone(),
                                        needs_attention: false,
                                        exited: false,
                                        exit_code: None,
                                        buffer_size: term.output_buffer.len(),
                                        completed: true,
                                    },
                                );
                            } else if detected_failed {
                                already_completed = true;
                                let _ = app_for_reader.emit(
                                    "headless-terminal-status",
                                    HeadlessTerminalStatus {
                                        terminal_id: tid.clone(),
                                        needs_attention: true,
                                        exited: false,
                                        exit_code: None,
                                        buffer_size: term.output_buffer.len(),
                                        completed: false,
                                    },
                                );
                            } else if was_needs_attention {
                                // If we were in "needs attention", clear it
                                was_needs_attention = false;
                                let _ = app_for_reader.emit(
                                    "headless-terminal-status",
                                    HeadlessTerminalStatus {
                                        terminal_id: tid.clone(),
                                        needs_attention: false,
                                        exited: false,
                                        exit_code: None,
                                        buffer_size: term.output_buffer.len(),
                                        completed: term.completed,
                                    },
                                );
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }

        // Process exited
        let (exit_code, is_completed) = if let Ok(mut headless) = headless_ref.lock() {
            if let Some(term) = headless.get_mut(&tid) {
                let code = term
                    .child
                    .wait()
                    .ok()
                    .map(|status| status.exit_code() as i32);
                term.exited = true;
                term.exit_code = code;
                let completed = term.completed;

                // Forward exit to live channel if attached
                if let Some(ref channel) = term.live_channel {
                    let _ = channel.send(TerminalEvent::Exit { code });
                }

                (code, completed)
            } else {
                (None, false)
            }
        } else {
            (None, false)
        };

        let _ = app_for_reader.emit(
            "headless-terminal-status",
            HeadlessTerminalStatus {
                terminal_id: tid.clone(),
                needs_attention: false,
                exited: true,
                exit_code,
                buffer_size: 0,
                completed: is_completed,
            },
        );
    });

    // Spawn needs-attention timer thread
    let tid2 = terminal_id.clone();
    let headless_ref2 = Arc::clone(&state.headless_terminals);
    let app_for_timer = app_handle;
    std::thread::spawn(move || {
        let mut last_was_attention = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));

            let status = if let Ok(headless) = headless_ref2.lock() {
                if let Some(term) = headless.get(&tid2) {
                    if term.exited {
                        break; // Stop checking
                    }
                    let elapsed = term.last_output_time.elapsed().as_secs();
                    let needs_attention = elapsed >= 15;
                    Some((needs_attention, term.output_buffer.len(), term.completed))
                } else {
                    break; // Terminal removed
                }
            } else {
                break;
            };

            if let Some((needs_attention, buf_size, completed)) = status {
                if needs_attention != last_was_attention {
                    last_was_attention = needs_attention;
                    let _ = app_for_timer.emit(
                        "headless-terminal-status",
                        HeadlessTerminalStatus {
                            terminal_id: tid2.clone(),
                            needs_attention,
                            exited: false,
                            exit_code: None,
                            buffer_size: buf_size,
                            completed,
                        },
                    );
                }
            }
        }
    });

    // Send initial command after a delay if provided
    if let Some(cmd) = initial_command {
        let tid3 = terminal_id.clone();
        let headless_ref3 = Arc::clone(&state.headless_terminals);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(2000));
            let Ok(mut headless) = headless_ref3.lock() else {
                return;
            };
            if let Some(term) = headless.get_mut(&tid3) {
                let safe_cmd = strip_control_chars(&cmd);
                let _ = term.writer.write_all(safe_cmd.as_bytes());
                let _ = term.writer.write_all(b"\r");
                let _ = term.writer.flush();
            }
        });
    }

    Ok(terminal_id)
}

#[tauri::command]
pub fn get_terminal_buffer(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Vec<u8>, String> {
    let headless = state
        .headless_terminals
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(term) = headless.get(&terminal_id) {
        Ok(term.output_buffer.clone())
    } else {
        Err("Headless terminal not found".to_string())
    }
}

#[tauri::command]
pub fn attach_terminal_channel(
    state: State<'_, AppState>,
    terminal_id: String,
    on_event: Channel<TerminalEvent>,
) -> Result<Vec<u8>, String> {
    let mut headless = state
        .headless_terminals
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(term) = headless.get_mut(&terminal_id) {
        let buffer = term.output_buffer.clone();
        term.live_channel = Some(on_event);
        Ok(buffer)
    } else {
        Err("Headless terminal not found".to_string())
    }
}

#[tauri::command]
pub fn write_to_headless_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let mut headless = state
        .headless_terminals
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(term) = headless.get_mut(&terminal_id) {
        term.writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        term.writer
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    } else {
        Err("Headless terminal not found".to_string())
    }
}

#[tauri::command]
pub fn resize_headless_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    validate_pty_size(rows, cols)?;
    let headless = state
        .headless_terminals
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(term) = headless.get(&terminal_id) {
        term.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
        Ok(())
    } else {
        Err("Headless terminal not found".to_string())
    }
}

#[tauri::command]
pub fn close_headless_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<(), String> {
    let mut headless = state
        .headless_terminals
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(mut term) = headless.remove(&terminal_id) {
        let _ = term.child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn get_all_headless_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<HeadlessTerminalStatus>, String> {
    let headless = state
        .headless_terminals
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    let statuses: Vec<HeadlessTerminalStatus> = headless
        .iter()
        .map(|(id, term)| {
            let elapsed = term.last_output_time.elapsed().as_secs();
            HeadlessTerminalStatus {
                terminal_id: id.clone(),
                needs_attention: !term.exited && elapsed >= 15,
                exited: term.exited,
                exit_code: term.exit_code,
                buffer_size: term.output_buffer.len(),
                completed: term.completed,
            }
        })
        .collect();
    Ok(statuses)
}

#[cfg(test)]
mod tests {
    use super::{strip_control_chars, terminal_program};

    #[test]
    fn terminal_program_selects_each_supported_terminal_kind() {
        assert_eq!(terminal_program(true, false).unwrap(), "claude");
        assert_eq!(terminal_program(false, true).unwrap(), "codex");
        assert_eq!(terminal_program(false, false).unwrap(), "shell");
    }

    #[test]
    fn terminal_program_rejects_ambiguous_agent_kind() {
        assert!(terminal_program(true, true).is_err());
    }

    #[test]
    fn strip_control_chars_removes_cr_lf_nul() {
        assert_eq!(strip_control_chars("hello\rworld"), "helloworld");
        assert_eq!(strip_control_chars("hello\nworld"), "helloworld");
        assert_eq!(strip_control_chars("hello\0world"), "helloworld");
        assert_eq!(strip_control_chars("hello\r\nworld"), "helloworld");
    }

    #[test]
    fn strip_control_chars_passes_printable_and_unicode() {
        assert_eq!(strip_control_chars("/reggie-code-workflow --yes my-slug"), "/reggie-code-workflow --yes my-slug");
        assert_eq!(strip_control_chars("café résumé"), "café résumé");
        assert_eq!(strip_control_chars(""), "");
    }

    #[test]
    fn strip_control_chars_removes_other_c0_controls() {
        // Bell, backspace, and escape are all < 0x20 and must be stripped.
        // An attacker that smuggled an ESC (0x1B) into a command could otherwise
        // start an ANSI/CSI sequence the terminal would interpret.
        assert_eq!(strip_control_chars("ring\x07bell"), "ringbell");
        assert_eq!(strip_control_chars("back\x08space"), "backspace");
        assert_eq!(strip_control_chars("esc\x1Bape"), "escape");
        // Sweep across the entire C0 range (0x00..=0x1F).
        for b in 0u8..0x20 {
            let s = format!("a{}b", b as char);
            assert_eq!(strip_control_chars(&s), "ab", "byte 0x{:02X} should be stripped", b);
        }
    }

    #[test]
    fn strip_control_chars_preserves_del_and_high_bytes() {
        // The function's contract is "< 0x20"; DEL (0x7F) is intentionally not
        // stripped. Pin that so a future change to the predicate is a deliberate
        // decision, not an accident.
        assert_eq!(strip_control_chars("a\x7Fb"), "a\u{007F}b");
        // Space (0x20) is the boundary and must pass.
        assert_eq!(strip_control_chars("a b"), "a b");
    }
}
