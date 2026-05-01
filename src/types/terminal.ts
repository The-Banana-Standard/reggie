export interface TerminalTab {
  id: string;
  terminalId: string | null; // null until spawned
  label: string;
  isClaudeSession: boolean;
  isProjectOverview?: boolean; // Project overview tab (no terminal, shows ProjectSummaryPanel)
  sessionId?: string;
  projectPath: string;
  projectName?: string; // Display name for the project
  initialPrompt?: string; // Sent to Claude after spawn (e.g. "/skill-name")
  model?: string; // Claude CLI --model flag
  effort?: string; // Claude CLI --effort flag
  dead?: boolean; // Process has exited
  isHeadlessPromoted?: boolean; // Tab was promoted from a headless session
  headlessTerminalId?: string; // The headless terminal ID (for promoted tabs)
  headlessCompleted?: boolean; // Carried from headless session on promote (for demote round-trip)
  visible?: boolean; // Whether this session is shown on the Sessions tab (undefined = true for backward compat)
}

export type TerminalEvent =
  | { type: "output"; data: number[] }
  | { type: "exit"; code: number | null };

export interface HeadlessSession {
  terminalId: string;
  projectPath: string;
  projectName: string;
  label: string;
  needsAttention: boolean;
  exited: boolean;
  exitCode: number | null;
  bufferSize: number;
  completed: boolean;
  autoRelaunch?: boolean;
}

export interface HeadlessTerminalStatus {
  terminalId: string;
  needsAttention: boolean;
  exited: boolean;
  exitCode: number | null;
  bufferSize: number;
  completed: boolean;
}

export interface TaskItem {
  slug: string;
  description: string;
  /** Mode tag from the parsed task: "code" | "design" | "manual" | "reggie-system" | "debug" | null. */
  mode?: string | null;
}

export interface RepoTaskSummary {
  name: string;
  path: string;
  workspaceName: string | null;
  ungroomedCount: number;
  groomedCount: number;
  activeCount: number;
  ungroomedTasks?: TaskItem[];
  groomedTasks?: TaskItem[];
  activeTasks?: TaskItem[];
}
