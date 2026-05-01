//! Filesystem watcher for `TASKS.md` files under an active workspace path.
//!
//! When any `TASKS.md` file under the watched root is created, modified, or
//! removed, this watcher emits a debounced `tasks-md-changed` event on the
//! Tauri app handle so the frontend can re-scan tasks.
//!
//! Debouncing: a pending 300ms timer is reset on every matching event, so
//! rapid bursts of writes coalesce into a single emit.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;

const DEBOUNCE_MS: u64 = 300;
const EVENT_NAME: &str = "tasks-md-changed";

/// Owns the active filesystem watcher and the pending debounce task.
///
/// Dropping this value releases the OS-level watch and cancels any in-flight
/// debounce timer.
pub struct TasksWatcher {
    /// Held to keep the watcher alive — dropping it stops the watch.
    _watcher: RecommendedWatcher,
    /// Pending debounce task; aborted when a new event arrives or on drop.
    pending: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl Drop for TasksWatcher {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.pending.lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
            }
        }
    }
}

/// Returns true when `path`'s file name is `TASKS.md`.
fn is_tasks_md(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n == "TASKS.md")
        .unwrap_or(false)
}

/// Returns true when any path in the event refers to a `TASKS.md` file.
fn event_touches_tasks_md(event: &Event) -> bool {
    event.paths.iter().any(|p| is_tasks_md(p))
}

/// Start watching `path` recursively for `TASKS.md` changes.
///
/// On every relevant event, schedules a debounced emit of `tasks-md-changed`
/// on `app`. The returned `TasksWatcher` must be retained — dropping it stops
/// the watch.
///
/// `path` does not need to contain any `TASKS.md` files yet; the watcher
/// tolerates missing files because it only fires on events that explicitly
/// touch a `TASKS.md` path.
pub fn start(app: AppHandle, path: PathBuf) -> notify::Result<TasksWatcher> {
    start_with_callback(path, move || {
        if let Err(e) = app.emit(EVENT_NAME, ()) {
            eprintln!("[tasks-md-watcher] failed to emit {EVENT_NAME}: {e}");
        }
    })
}

/// Start watching `path` recursively for `TASKS.md` changes, invoking `on_fire`
/// after the debounce window once events have settled.
///
/// This is the testable core of `start()` — `start()` is just this function
/// with an `AppHandle::emit` callback. Splitting them lets unit tests verify
/// debounce coalescing and Drop-cancellation semantics without spinning up a
/// Tauri runtime.
fn start_with_callback<F>(path: PathBuf, on_fire: F) -> notify::Result<TasksWatcher>
where
    F: Fn() + Send + Sync + 'static,
{
    let pending: Arc<Mutex<Option<JoinHandle<()>>>> = Arc::new(Mutex::new(None));
    let pending_for_handler = Arc::clone(&pending);
    let on_fire = Arc::new(on_fire);

    // Capture the current Tokio runtime handle so the notify callback (which
    // runs on a non-Tokio native thread) can still spawn debounce tasks.
    // `start()` is always called from a Tauri command, which runs on the
    // tokio runtime, so `Handle::current()` is safe here.
    let runtime_handle = tokio::runtime::Handle::current();

    let mut watcher = recommended_watcher(move |res: notify::Result<Event>| {
        let event = match res {
            Ok(ev) => ev,
            Err(e) => {
                eprintln!("[tasks-md-watcher] watch error: {e}");
                return;
            }
        };

        if !event_touches_tasks_md(&event) {
            return;
        }

        // Reset the debounce timer: cancel any pending fire and spawn a new one.
        let on_fire_for_timer = Arc::clone(&on_fire);
        let new_handle = runtime_handle.spawn(async move {
            tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS)).await;
            on_fire_for_timer();
        });

        if let Ok(mut guard) = pending_for_handler.lock() {
            if let Some(prev) = guard.replace(new_handle) {
                prev.abort();
            }
        }
    })?;

    if let Err(e) = watcher.watch(&path, RecursiveMode::Recursive) {
        eprintln!(
            "[tasks-md-watcher] failed to watch {}: {e}",
            path.display()
        );
        return Err(e);
    }

    Ok(TasksWatcher {
        _watcher: watcher,
        pending,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[test]
    fn is_tasks_md_matches_basename() {
        assert!(is_tasks_md(&PathBuf::from("/tmp/repo/TASKS.md")));
        assert!(is_tasks_md(&PathBuf::from("TASKS.md")));
        assert!(!is_tasks_md(&PathBuf::from("/tmp/repo/tasks.md")));
        assert!(!is_tasks_md(&PathBuf::from("/tmp/repo/TASKS.md.bak")));
        assert!(!is_tasks_md(&PathBuf::from("/tmp/repo/README.md")));
        assert!(!is_tasks_md(&PathBuf::from("/tmp/repo/")));
    }

    /// Rapid-fire writes within the debounce window should coalesce into a
    /// single callback invocation.
    #[tokio::test(flavor = "multi_thread")]
    async fn debounce_coalesces_rapid_events() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tasks_path = dir.path().join("TASKS.md");
        // Ensure the file exists before we start watching so writes produce
        // Modify events (rather than only Create + Modify on first touch).
        std::fs::write(&tasks_path, b"initial").expect("seed write");

        let counter = Arc::new(AtomicUsize::new(0));
        let counter_for_cb = Arc::clone(&counter);

        let watcher = start_with_callback(dir.path().to_path_buf(), move || {
            counter_for_cb.fetch_add(1, Ordering::SeqCst);
        })
        .expect("watcher start");

        // 5 rapid writes within ~50ms — well inside the 300ms debounce window.
        for i in 0..5 {
            std::fs::write(&tasks_path, format!("write-{i}")).expect("write");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        // Wait long enough for the debounce to fire (300ms) plus slack.
        tokio::time::sleep(Duration::from_millis(600)).await;

        let count = counter.load(Ordering::SeqCst);
        assert_eq!(
            count, 1,
            "expected exactly one debounced callback for rapid writes, got {count}"
        );

        drop(watcher);
    }

    /// Dropping the watcher before the debounce window elapses must cancel
    /// the pending callback so no stale event fires after stop.
    #[tokio::test(flavor = "multi_thread")]
    async fn drop_cancels_pending_callback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tasks_path = dir.path().join("TASKS.md");
        std::fs::write(&tasks_path, b"initial").expect("seed write");

        let counter = Arc::new(AtomicUsize::new(0));
        let counter_for_cb = Arc::clone(&counter);

        let watcher = start_with_callback(dir.path().to_path_buf(), move || {
            counter_for_cb.fetch_add(1, Ordering::SeqCst);
        })
        .expect("watcher start");

        // Trigger one event, then drop the watcher well before the 300ms
        // debounce window elapses.
        std::fs::write(&tasks_path, b"trigger").expect("write");
        tokio::time::sleep(Duration::from_millis(50)).await;
        drop(watcher);

        // Wait past the debounce window + slack.
        tokio::time::sleep(Duration::from_millis(500)).await;

        let count = counter.load(Ordering::SeqCst);
        assert_eq!(
            count, 0,
            "callback must not fire after watcher drop, got {count} invocations"
        );
    }
}
