/**
 * Tauri Command Contract Validation
 *
 * Verifies that TypeScript invoke() calls match the Rust #[tauri::command] signatures.
 * This catches mismatches (typos, renamed args, missing params) before runtime.
 *
 * Source of truth: Rust side. Each entry maps a command name to its expected
 * argument keys (excluding `state: State<'_, AppState>` and `Channel` params,
 * which Tauri handles automatically).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Rust command → expected arg keys ──
// Derived from #[tauri::command] function signatures in src-tauri/src/commands/*.rs
// State<'_, AppState> and Channel<T> params are injected by Tauri, not passed from TS.
const RUST_COMMANDS: Record<string, string[]> = {
  // terminal.rs
  check_claude_cli: [],
  spawn_terminal: [
    "projectPath",
    "isClaudeSession",
    "sessionId",
    "initialCommand",
    "systemPrompt",
    "model",
    "effort",
    "onEvent",
  ],
  write_to_terminal: ["terminalId", "data"],
  resize_terminal: ["terminalId", "rows", "cols"],
  close_terminal: ["terminalId"],
  spawn_headless_terminal: ["projectPath", "initialCommand", "model", "effort"],
  get_terminal_buffer: ["terminalId"],
  attach_terminal_channel: ["terminalId", "onEvent"],
  write_to_headless_terminal: ["terminalId", "data"],
  resize_headless_terminal: ["terminalId", "rows", "cols"],
  close_headless_terminal: ["terminalId"],
  get_all_headless_statuses: [],

  // claude_data.rs
  get_sessions_for_project: ["projectPath"],
  read_claude_md: ["projectPath"],
  get_claude_usage_stats: [],

  // projects.rs
  scan_workspace: ["workspacePath"],
  scan_all_projects: ["folderPath"],
  get_project_info: ["projectPath"],
  get_parallelizable_tasks: ["projectPath"],
  scan_tasks_across_repos: ["folderPath"],
  append_ungroomed_tasks: ["projectPath", "tasks"],
  save_attachment_image: ["projectPath", "dirName", "extension", "imageBytes"],
  cleanup_attachments: ["projectPath", "dirNames"],
  list_orphan_attachments: ["projectPath"],

  // git.rs
  get_git_log: ["projectPath", "limit"],

  // reggie_data.rs
  get_agents: [],
  get_commands: ["projectPath"],
  get_pipelines: [],

  // run_locally.rs
  check_run_script: ["projectPath"],
  open_in_browser: ["url"],

  // skills.rs
  get_skills: ["projectPath"],
  install_skill: ["id", "sourceUrl", "format"],
  uninstall_skill: ["id", "format"],
  check_skills_installed: ["skillIds"],

  // bookmarks.rs
  read_bookmarks: [],
  write_bookmarks: ["bookmarks"],

  // pipeline_bindings.rs
  get_pipeline_bindings: [],
  set_pipeline_binding: ["mode", "pipelineName"],
  clear_pipeline_binding: ["mode"],

  // installer.rs — src-tauri/src/installer.rs
  get_install_status: [],
  get_detailed_install_status: [],
  get_shell_export_line: [],
  force_reinstall: [],
  add_to_shell_profile: [],
  complete_setup: [],
  uninstall_reggie_files: ["removeShellProfile"],
};

/**
 * Commands registered in Rust but invoked from outside the TypeScript frontend
 * (e.g. by Claude Code via slash-command markdown like `reggie-init-tasks.md`,
 * which calls Tauri commands at agent runtime). These are NOT bugs — the
 * contract scanner only sees `invoke()` calls in `.ts/.tsx` source.
 */
const MARKDOWN_INVOKED_COMMANDS = new Set<string>([
  "cleanup_attachments",
  "list_orphan_attachments",
]);

/**
 * Extract all invoke("command_name", { ...args }) calls from TypeScript source files.
 * Returns a map of command name → Set of arg keys found across all call sites.
 */
function extractInvokeCalls(srcDir: string): Map<string, Set<string>> {
  const calls = new Map<string, Set<string>>();

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "__test-utils__" || entry.name === "node_modules") continue;
        walk(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const content = fs.readFileSync(fullPath, "utf-8");
        // Match invoke("command_name") and invoke<Type>("command_name")
        // with optional second arg { key1, key2 } or { key1: val, key2: val }
        const invokePattern = /invoke(?:<[^>]+>)?\(\s*"([^"]+)"(?:\s*,\s*\{([^}]*)\})?\s*\)/g;
        let match;
        while ((match = invokePattern.exec(content)) !== null) {
          const command = match[1];
          const argsStr = match[2]?.trim();
          const argKeys = new Set<string>();

          if (argsStr) {
            // Split on commas, take only the first identifier in each segment.
            // This correctly handles both shorthand (`{ key }`) and
            // key-value (`{ key: expr }`) without picking up value tokens.
            for (const segment of argsStr.split(",")) {
              const m = segment.trim().match(/^(\w+)/);
              if (m) argKeys.add(m[1]);
            }
          }

          if (!calls.has(command)) {
            calls.set(command, new Set());
          }
          const existing = calls.get(command)!;
          for (const key of argKeys) {
            existing.add(key);
          }
        }
      }
    }
  }

  walk(srcDir);
  return calls;
}

describe("Tauri command contract", () => {
  const srcDir = path.resolve(__dirname, "..");
  const tsCalls = extractInvokeCalls(srcDir);

  it("all TS invoke commands exist in Rust", () => {
    const unknownCommands: string[] = [];
    for (const command of tsCalls.keys()) {
      if (!(command in RUST_COMMANDS)) {
        unknownCommands.push(command);
      }
    }
    expect(unknownCommands, `Unknown commands called from TS: ${unknownCommands.join(", ")}`).toEqual([]);
  });

  it("all Rust commands are called from TS (excluding markdown-invoked)", () => {
    const uncalledCommands: string[] = [];
    for (const command of Object.keys(RUST_COMMANDS)) {
      if (MARKDOWN_INVOKED_COMMANDS.has(command)) continue;
      if (!tsCalls.has(command)) {
        uncalledCommands.push(command);
      }
    }
    expect(uncalledCommands, `Rust commands never called from TS: ${uncalledCommands.join(", ")}`).toEqual([]);
  });

  // Per-command arg matching
  for (const [command, expectedArgs] of Object.entries(RUST_COMMANDS)) {
    if (expectedArgs.length === 0) continue; // skip no-arg commands

    it(`"${command}" TS args match Rust signature`, () => {
      const tsArgs = tsCalls.get(command);
      if (!tsArgs) {
        // Command not called from TS — caught by the "all Rust commands are called" test
        return;
      }

      const missingArgs = expectedArgs.filter((arg) => !tsArgs.has(arg));
      const extraArgs = [...tsArgs].filter((arg) => !expectedArgs.includes(arg));

      expect(missingArgs, `Missing args for "${command}": ${missingArgs.join(", ")}`).toEqual([]);
      expect(extraArgs, `Extra args for "${command}": ${extraArgs.join(", ")}`).toEqual([]);
    });
  }
});
