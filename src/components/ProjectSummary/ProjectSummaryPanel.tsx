import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import type { ClaudeSession } from "../../types/claude-session";
import type { ProjectInfo } from "../../types/project-info";
import { SessionCard } from "./SessionCard";
import { GitLogView } from "./GitLogView";
import { TasksViewer } from "../TasksViewer/TasksViewer";
import { checkRunScript } from "../../services/terminal-service";

const SINGLE_TASK_MAX_LENGTH = 200;
const LIST_PREFIX_REGEX = /^(?:[-*+]\s|\d+[.)]\s)/;
const IMAGE_LABEL_REGEX = /\[Image (\d+)\]/g;
const IMAGE_MIME_WHITELIST: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const IMAGE_EXT_WHITELIST: Record<string, string> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  gif: "gif",
  webp: "webp",
};
const PASTE_ERROR_TIMEOUT_MS = 4000;

interface ImageEntry {
  bytes: Uint8Array;
  ext: string;
}

interface AttachmentPayload {
  label: string;
  path: string;
}

interface TaskWithAttachments {
  description: string;
  attachments: AttachmentPayload[];
}

function slugify(input: string): string {
  // Mirrors the Rust `to_kebab_case`: lowercase, non-alphanumeric → '-', collapse + trim.
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function randomSuffix(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function classifyImageFile(file: File): { ok: true; ext: string } | { ok: false; reason: "heic" | "unsupported" } {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const dotIdx = name.lastIndexOf(".");
  const filenameExt = dotIdx >= 0 ? name.slice(dotIdx + 1) : "";

  if (mime === "image/heic" || mime === "image/heif" || filenameExt === "heic" || filenameExt === "heif") {
    return { ok: false, reason: "heic" };
  }

  if (mime && IMAGE_MIME_WHITELIST[mime]) {
    return { ok: true, ext: IMAGE_MIME_WHITELIST[mime] };
  }

  if (filenameExt && IMAGE_EXT_WHITELIST[filenameExt]) {
    return { ok: true, ext: IMAGE_EXT_WHITELIST[filenameExt] };
  }

  return { ok: false, reason: "unsupported" };
}

export function parseTaskInput(raw: string): string[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  // Check if input looks like a list (multiple lines with list prefixes)
  const listLines = lines.filter((l) => LIST_PREFIX_REGEX.test(l));
  const isMultipleList = listLines.length > 1 || (listLines.length === 1 && lines.length === 1);

  if (isMultipleList) {
    // Parse each line, stripping list prefixes
    return lines
      .map((l) => l.replace(LIST_PREFIX_REGEX, "").trim())
      .filter((l) => l.length > 0);
  }

  // Single task: join all lines, truncate to limit
  const single = lines.join(" ");
  return [single.length > SINGLE_TASK_MAX_LENGTH ? single.slice(0, SINGLE_TASK_MAX_LENGTH) : single];
}

interface ProjectSummaryPanelProps {
  projectName: string;
  projectPath: string;
  onResumeSession: (sessionId: string) => void;
  onNewSession?: () => void;
  onNewShell?: () => void;
  onRunLocally?: (port: number, hasScript: boolean) => void;
  onStopLocally?: () => void;
  runLocallyState?: "idle" | "starting" | "running";
  onStartTask?: (slug: string) => void;
  onTasksAdded?: () => void;
  taskInput?: string;
  onTaskInputChange?: (value: string) => void;
}

export function ProjectSummaryPanel({
  projectName,
  projectPath,
  onResumeSession,
  onNewSession,
  onNewShell,
  onRunLocally,
  onStopLocally,
  runLocallyState = "idle",
  onStartTask,
  onTasksAdded,
  taskInput: externalTaskInput,
  onTaskInputChange,
}: ProjectSummaryPanelProps) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [localTaskInput, setLocalTaskInput] = useState("");
  const taskInput = externalTaskInput ?? localTaskInput;
  const setTaskInput = onTaskInputChange ?? setLocalTaskInput;
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [taskSuccess, setTaskSuccess] = useState(false);
  // Counter and map are not read in render — refs avoid React's StrictMode
  // double-invocation of state updaters and keep label assignment atomic.
  const imageCounterRef = useRef(1);
  const imageMapRef = useRef<Record<string, ImageEntry>>({});
  const [pasteError, setPasteError] = useState<string | null>(null);
  const pasteErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const currentPath = useRef(projectPath);

  const loadProjectData = useCallback((path: string) => {
    Promise.all([
      invoke<ClaudeSession[]>("get_sessions_for_project", { projectPath: path }),
      invoke<ProjectInfo>("get_project_info", { projectPath: path }),
    ])
      .then(([sessionData, projectInfo]) => {
        if (currentPath.current === path) {
          setSessions(sessionData);
          setInfo(projectInfo);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load project data:", err);
        if (currentPath.current === path) {
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    currentPath.current = projectPath;
    setLoading(true);
    setSessions([]);
    setInfo(null);
    if (!onTaskInputChange) setLocalTaskInput("");
    setTaskSuccess(false);
    imageCounterRef.current = 1;
    imageMapRef.current = {};
    setPasteError(null);
    if (pasteErrorTimeoutRef.current !== null) {
      clearTimeout(pasteErrorTimeoutRef.current);
      pasteErrorTimeoutRef.current = null;
    }
    loadProjectData(projectPath);
  }, [projectPath, loadProjectData, onTaskInputChange]);

  useEffect(() => {
    return () => {
      if (pasteErrorTimeoutRef.current !== null) {
        clearTimeout(pasteErrorTimeoutRef.current);
      }
    };
  }, []);

  const showPasteError = useCallback((message: string) => {
    setPasteError(message);
    if (pasteErrorTimeoutRef.current !== null) {
      clearTimeout(pasteErrorTimeoutRef.current);
    }
    pasteErrorTimeoutRef.current = setTimeout(() => {
      setPasteError(null);
      pasteErrorTimeoutRef.current = null;
    }, PASTE_ERROR_TIMEOUT_MS);
  }, []);

  const insertPlaceholderAtCursor = useCallback(
    (placeholder: string) => {
      const textarea = taskTextareaRef.current;
      const current = taskInput;
      if (textarea && document.activeElement === textarea) {
        const start = textarea.selectionStart ?? current.length;
        const end = textarea.selectionEnd ?? current.length;
        const next = current.slice(0, start) + placeholder + current.slice(end);
        setTaskInput(next);
        // Restore cursor position right after the inserted placeholder.
        const cursorPos = start + placeholder.length;
        requestAnimationFrame(() => {
          if (taskTextareaRef.current) {
            taskTextareaRef.current.focus();
            taskTextareaRef.current.setSelectionRange(cursorPos, cursorPos);
          }
        });
      } else {
        const needsSpace = current.length > 0 && !current.endsWith(" ") && !current.endsWith("\n");
        setTaskInput(current + (needsSpace ? " " : "") + placeholder);
      }
    },
    [taskInput, setTaskInput],
  );

  const ingestImageFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      let sawHeic = false;
      let sawUnsupported = false;
      const accepted: { bytes: Uint8Array; ext: string }[] = [];

      for (const file of files) {
        const result = classifyImageFile(file);
        if (!result.ok) {
          if (result.reason === "heic") sawHeic = true;
          else sawUnsupported = true;
          continue;
        }
        try {
          const buf = await file.arrayBuffer();
          accepted.push({ bytes: new Uint8Array(buf), ext: result.ext });
        } catch (err) {
          console.error("Failed to read image bytes:", err);
          sawUnsupported = true;
        }
      }

      // Stage accepted images: assign labels, update map, insert placeholders.
      if (accepted.length > 0) {
        const placeholders: string[] = [];
        for (const item of accepted) {
          const label = `Image ${imageCounterRef.current}`;
          imageMapRef.current[label] = { bytes: item.bytes, ext: item.ext };
          placeholders.push(`[${label}]`);
          imageCounterRef.current += 1;
        }
        insertPlaceholderAtCursor(placeholders.join(" "));
      }

      if (sawHeic) {
        showPasteError("HEIC images aren't supported — paste a PNG or JPG instead.");
      } else if (sawUnsupported) {
        showPasteError("Unsupported image type — paste a PNG, JPG, GIF, or WebP.");
      }
    },
    [insertPlaceholderAtCursor, showPasteError],
  );

  const handleTextareaPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      void ingestImageFiles(files);
    },
    [ingestImageFiles],
  );

  const handleTextareaDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      const dropped = e.dataTransfer?.files;
      if (!dropped || dropped.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < dropped.length; i++) {
        const file = dropped[i];
        if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(file.name)) {
          files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      void ingestImageFiles(files);
    },
    [ingestImageFiles],
  );

  const handleTextareaDragOver = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
    }
  }, []);

  const handleTaskSubmit = useCallback(async () => {
    const lines = parseTaskInput(taskInput);
    if (lines.length === 0) return;

    setTaskSubmitting(true);
    try {
      const imageMap = imageMapRef.current;
      const tasksPayload: TaskWithAttachments[] = await Promise.all(
        lines.map(async (description) => {
          const matches = Array.from(description.matchAll(IMAGE_LABEL_REGEX));
          const labels = Array.from(new Set(matches.map((m) => `Image ${m[1]}`)));
          const owned = labels.filter((l) => imageMap[l] !== undefined);
          // Skip the I/O if there are no staged images, OR if the description
          // would slug to empty (the Rust side drops those tasks anyway, so the
          // saved files would just become orphans).
          const baseSlug = slugify(description);
          if (owned.length === 0 || baseSlug.length === 0) {
            return { description, attachments: [] };
          }

          // One dirName per task (groups all of this task's images together).
          // Saves into the same dirName must run sequentially: the Rust side
          // computes the next index from the dir's current max + 1, so parallel
          // calls would all see the same starting index and clobber each other.
          const dirName = `${baseSlug}-${randomSuffix(6)}`;
          const attachments: AttachmentPayload[] = [];
          for (const label of owned) {
            const entry = imageMap[label];
            const result = await invoke<{ path: string }>("save_attachment_image", {
              projectPath,
              dirName,
              extension: entry.ext,
              imageBytes: Array.from(entry.bytes),
            });
            attachments.push({ label, path: result.path });
          }
          return { description, attachments };
        }),
      );

      await invoke("append_ungroomed_tasks", { projectPath, tasks: tasksPayload });

      setTaskInput("");
      imageCounterRef.current = 1;
      imageMapRef.current = {};
      setTaskSuccess(true);
      setTimeout(() => setTaskSuccess(false), 2000);
      loadProjectData(projectPath);
      onTasksAdded?.();
    } catch (err) {
      console.error("Failed to add tasks:", err);
    } finally {
      setTaskSubmitting(false);
    }
  }, [taskInput, projectPath, loadProjectData, onTasksAdded, setTaskInput]);

  const pendingRunRef = useRef(false);
  const handleRunLocally = useCallback(() => {
    if (!onRunLocally || pendingRunRef.current) return;
    pendingRunRef.current = true;
    checkRunScript(projectPath)
      .then(({ port, exists }) => {
        onRunLocally(port, exists);
      })
      .catch(console.error)
      .finally(() => {
        pendingRunRef.current = false;
      });
  }, [projectPath, onRunLocally]);

  if (loading) {
    return (
      <div className="summary-panel">
        <div className="summary-loading">Loading project...</div>
      </div>
    );
  }

  return (
    <div className="summary-panel">
      {/* Project Header */}
      <div className="project-header">
        <h2 className="project-title">{projectName}</h2>
        {info && info.techStack.length > 0 && (
          <div className="tech-stack">
            {info.techStack.map((t) => (
              <span key={t} className="tech-badge">{t}</span>
            ))}
          </div>
        )}
        {info?.gitBranch && (
          <div className="project-git-info">
            <span className="git-branch-badge">{info.gitBranch}</span>
            {info.lastCommit && (
              <span className="git-commit">{info.lastCommit}</span>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {(onNewSession || onNewShell || onRunLocally) && (
        <div className="project-actions">
          {onNewSession && (
            <button className="project-action-btn claude" onClick={onNewSession}>
              &gt; New Session
            </button>
          )}
          {onNewShell && (
            <button className="project-action-btn shell" onClick={onNewShell}>
              $ New Shell
            </button>
          )}
          {onRunLocally && (
            <button
              className="project-action-btn shell"
              onClick={runLocallyState === "idle" ? handleRunLocally : runLocallyState === "running" ? onStopLocally : undefined}
              disabled={runLocallyState === "starting"}
            >
              {runLocallyState === "idle" && "▶ Run Locally"}
              {runLocallyState === "starting" && "Starting..."}
              {runLocallyState === "running" && "■ Stop"}
            </button>
          )}
        </div>
      )}

      {/* Project Description */}
      {info?.description && (
        <div className="project-description">
          {info.description}
        </div>
      )}

      {/* TASKS.md Section — interactive viewer */}
      {info?.tasksMd && (
        <div className="info-section">
          <h4 className="info-section-title">TASKS.md</h4>
          {onStartTask ? (
            <TasksViewer tasksMd={info.tasksMd} onStartTask={onStartTask} />
          ) : (
            <div className="info-content markdown-content tasks-md-content">
              <ReactMarkdown>{info.tasksMd}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {/* Add Tasks Section */}
      <div className="info-section">
        <h4 className="info-section-title">Add Tasks</h4>
        <div className="add-tasks-form">
          <textarea
            ref={taskTextareaRef}
            className="add-tasks-textarea"
            placeholder="Add tasks (one per line, or use - / * / 1. for lists). Paste or drop images to attach."
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onPaste={handleTextareaPaste}
            onDrop={handleTextareaDrop}
            onDragOver={handleTextareaDragOver}
            rows={3}
            disabled={taskSubmitting}
          />
          {pasteError && (
            <div className="add-tasks-error" role="alert">
              {pasteError}
            </div>
          )}
          <div className="add-tasks-actions">
            {taskSuccess && (
              <span className="add-tasks-success">Tasks added</span>
            )}
            <button
              className="add-tasks-submit"
              onClick={handleTaskSubmit}
              disabled={taskSubmitting || taskInput.trim().length === 0}
            >
              {taskSubmitting ? "Adding..." : "Add to Ungroomed"}
            </button>
          </div>
        </div>
      </div>

      {/* Git Log */}
      {info?.isGitRepo && (
        <div className="info-section">
          <h4 className="info-section-title">Git Log</h4>
          <GitLogView projectPath={projectPath} isGitRepo={info.isGitRepo} />
        </div>
      )}

      {/* Recent Sessions */}
      <div className="info-section">
        <h4 className="info-section-title">
          Recent Sessions
          {sessions.length > 0 && (
            <span className="info-count">{sessions.length}</span>
          )}
        </h4>
        {sessions.length === 0 ? (
          <div className="summary-empty">
            No Claude sessions found for this project.
          </div>
        ) : (
          <div className="session-list">
            {sessions.map((s, i) => (
              <SessionCard
                key={s.sessionId || i}
                session={s}
                onResume={onResumeSession}
              />
            ))}
          </div>
        )}
      </div>

      {/* CLAUDE.md Section — rendered as markdown */}
      {info?.claudeMd && (
        <div className="info-section">
          <h4 className="info-section-title">CLAUDE.md</h4>
          <div className="info-content markdown-content claude-md-content">
            <ReactMarkdown>{info.claudeMd}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
