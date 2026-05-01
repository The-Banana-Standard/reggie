use portable_pty::{Child, MasterPty};
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::ipc::Channel;

use crate::commands::terminal::TerminalEvent;

pub struct TerminalInstance {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send>,
    #[allow(dead_code)]
    pub project_path: String,
    #[allow(dead_code)]
    pub is_claude_session: bool,
}

/// A headless terminal that buffers PTY output until a frontend tab attaches.
pub struct HeadlessTerminal {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send>,
    #[allow(dead_code)]
    pub project_path: String,
    pub output_buffer: Vec<u8>,
    pub last_output_time: Instant,
    /// Once set, live output is forwarded to this channel in addition to buffering.
    pub live_channel: Option<Channel<TerminalEvent>>,
    pub exited: bool,
    pub exit_code: Option<i32>,
    pub completed: bool,
}

pub struct AppState {
    pub terminals: Arc<Mutex<HashMap<String, TerminalInstance>>>,
    pub headless_terminals: Arc<Mutex<HashMap<String, HeadlessTerminal>>>,
    /// Active filesystem watcher for `TASKS.md` changes under the current
    /// workspace path. `None` when no path is being watched. Uses
    /// `tokio::sync::Mutex` so async commands can lock without blocking.
    pub tasks_watcher:
        Arc<tokio::sync::Mutex<Option<crate::watchers::tasks_md::TasksWatcher>>>,
    /// Serializes read-modify-write of `pipeline-bindings.json`. Holders perform the
    /// full read+mutate+write under this lock so concurrent IPC writers cannot lose
    /// each other's mutations. Readers (`get_pipeline_bindings`) skip the lock —
    /// the on-disk tmp+rename gives them a consistent old-or-new view.
    pub pipeline_bindings_lock: Arc<Mutex<()>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(Mutex::new(HashMap::new())),
            headless_terminals: Arc::new(Mutex::new(HashMap::new())),
            tasks_watcher: Arc::new(tokio::sync::Mutex::new(None)),
            pipeline_bindings_lock: Arc::new(Mutex::new(())),
        }
    }
}
