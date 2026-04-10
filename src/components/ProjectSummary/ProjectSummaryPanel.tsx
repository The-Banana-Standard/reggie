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
    loadProjectData(projectPath);
  }, [projectPath, loadProjectData, onTaskInputChange]);

  const handleTaskSubmit = useCallback(() => {
    const tasks = parseTaskInput(taskInput);
    if (tasks.length === 0) return;

    setTaskSubmitting(true);
    invoke("append_ungroomed_tasks", { projectPath, tasks })
      .then(() => {
        setTaskInput("");
        setTaskSuccess(true);
        setTimeout(() => setTaskSuccess(false), 2000);
        // Reload project info to refresh TASKS.md display
        loadProjectData(projectPath);
        // Notify parent to refresh session tracking (Init Tasks tab)
        onTasksAdded?.();
      })
      .catch((err) => {
        console.error("Failed to add tasks:", err);
      })
      .finally(() => {
        setTaskSubmitting(false);
      });
  }, [taskInput, projectPath, loadProjectData, onTasksAdded]);

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
            className="add-tasks-textarea"
            placeholder="Add tasks (one per line, or use - / * / 1. for lists)"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            rows={3}
            disabled={taskSubmitting}
          />
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
