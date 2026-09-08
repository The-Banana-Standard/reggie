// Generates the hand-written sample payloads (contract shapes) used by map-harness.html.
// Run: node ui/dev/gen-samples.mjs   (kept so the samples can be regenerated when the contract moves)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = "2026-09-07T12:00:00.000Z";
const kn = (own = 0, inherited = 0, stale = 0) => ({ own, inherited, stale, byType: {}, lastNoteDate: own ? "2026-09-06" : null, lowestConfidence: own ? "high" : null });
const hist = (c30, authors = [["jacobpress", 0.98]], lines = 400) => ({
  commits30: c30, commits90: c30 * 2, commits365: c30 * 5, linesChanged: lines, lastTouched: "2026-09-07",
  authors: authors.map(([h, share]) => ({ handle: h, name: h, email: `${h}@example.com`, lines: Math.round(lines * share), commits: Math.round(c30 * share), share })),
  busFactor: authors.filter(([, s]) => s >= 0.2).length,
});
function dir(path, label, o = {}) {
  const id = `dir:${path}/`;
  return {
    id, kind: "dir", label, path, parent: o.parent ?? "dir:./", lang: o.lang ?? "TypeScript", lines: o.lines ?? 0, role: "source", area: o.area ?? id,
    knowledge: o.knowledge ?? kn(), tasks: [], inDegree: 0, outDegree: 0, testedBy: [], entry: Boolean(o.entry), entryKinds: [],
    aggregates: { files: o.files, source: o.source, tests: o.tests ?? 0, config: 0, lines: o.lines ?? 0, documented: o.documented ?? 0, stale: o.stale ?? 0, testedSource: o.tested ?? 0, tasks: [], history: o.history ?? hist(3) },
    manifest: o.manifest ?? null, residual: Boolean(o.residual), dir: path, noteCount: o.knowledge?.own ?? 0, dirNoteCount: 0, ...(o.extra ?? {}),
  };
}
function file(path, o = {}) {
  const dirPath = path.slice(0, path.lastIndexOf("/"));
  return {
    id: path, kind: "file", label: path.slice(path.lastIndexOf("/") + 1), path, parent: `dir:${dirPath}/`, lang: o.lang ?? (path.endsWith(".rs") ? "Rust" : "TypeScript"),
    lines: o.lines ?? 120, role: o.role ?? "source", area: o.area ?? null, knowledge: o.knowledge ?? kn(0, 1), tasks: o.tasks ?? [],
    inDegree: o.inDegree ?? 0, outDegree: o.outDegree ?? 0, testedBy: o.testedBy ?? [], entry: Boolean(o.entry), entryKinds: o.entryKinds ?? [],
    history: o.history ?? hist(o.c30 ?? 0, o.authors), dir: dirPath, noteCount: o.knowledge?.own ?? 0, dirNoteCount: 0, ...(o.extra ?? {}),
  };
}
const edge = (source, target, o = {}) => ({ source, target, kind: o.kind ?? "import", ...(o.weight ? { weight: o.weight } : {}), ...(o.names ? { names: o.names } : {}), ...(o.via ? { via: o.via } : {}), ...(o.confidence ? { confidence: o.confidence } : {}), ...(o.cycle ? { cycle: true } : {}) });

// ---------------------------------------------------------------- container (Level 1)
const areas = [
  { id: "dir:packages/reggie/", label: "packages/reggie", hue: 2, source: 21, files: 32 },
  { id: "dir:src-tauri/", label: "src-tauri", hue: 3, source: 18, files: 19 },
  { id: "dir:src/components/", label: "src/components", hue: 1, source: 29, files: 54 },
  { id: "dir:src/hooks/", label: "src/hooks", hue: 4, source: 5, files: 10 },
  { id: "dir:src/types/", label: "src/types", hue: 5, source: 7, files: 8 },
  { id: "dir:src/services/", label: "src/services", hue: 0, source: 3, files: 6 },
  { id: "dir:src/", label: "src (other)", hue: 0, source: 5, files: 9 },
];
const container = {
  level: "container", root: "dir:./",
  nodes: [
    dir("packages/reggie", "reggie", { lang: "TypeScript", files: 32, source: 21, tests: 11, documented: 7, stale: 1, tested: 12, manifest: "package.json", knowledge: kn(1, 1, 1), history: hist(41), lines: 4200, extra: { entries: ["packages/reggie/src/cli.ts"] } }),
    dir("src-tauri", "src-tauri", { lang: "Rust", files: 19, source: 18, tests: 1, documented: 12, tested: 2, manifest: "Cargo.toml", knowledge: kn(1, 1), history: hist(2), lines: 3100, extra: { entries: ["src-tauri/src/main.rs"] } }),
    dir("src/components", "components", { files: 54, source: 29, tests: 25, documented: 0, tested: 20, knowledge: kn(0, 1), history: hist(9), lines: 5100 }),
    dir("src/hooks", "hooks", { files: 10, source: 5, tests: 5, documented: 3, tested: 5, knowledge: kn(1, 1), history: hist(4), lines: 700 }),
    dir("src/types", "types", { files: 8, source: 7, tests: 1, documented: 5, tested: 1, knowledge: kn(1, 1), history: hist(1), lines: 500 }),
    dir("src/services", "services", { files: 6, source: 3, tests: 3, documented: 1, tested: 3, knowledge: kn(0, 1), history: hist(6, [["jacobpress", 0.6], ["claude", 0.4]]), lines: 400 }),
    dir("src", "src (other)", { files: 9, source: 5, tests: 3, documented: 0, tested: 2, residual: true, knowledge: kn(0, 1), history: hist(12), lines: 600, extra: { entries: ["src/main.tsx"] } }),
  ],
  edges: [
    edge("dir:src/components/", "dir:src/types/", { weight: 41, via: [
      { source: "src/components/Terminal/Terminal.tsx", target: "src/types/terminal.ts", names: ["TerminalSession", "TerminalEvent", "PtySize", "TerminalTheme", "TerminalId", "ScrollbackLine", "TerminalMode"] },
      { source: "src/components/Sidebar/Sidebar.tsx", target: "src/types/terminal.ts", names: ["TerminalSession", "TerminalId", "TerminalMode", "TerminalTheme", "PtySize", "TerminalEvent", "TerminalState"] },
      { source: "src/components/ActivityBar/ActivityBar.tsx", target: "src/types/terminal.ts", names: ["TerminalSession", "TerminalId", "TerminalMode", "TerminalEvent", "TerminalState", "ScrollbackLine", "PtySize"] },
      { source: "src/components/WorkspaceOverview/WorkspaceOverview.tsx", target: "src/types/workspace.ts", names: ["Workspace", "WorkspaceProject", "ProjectSummary", "WorkspaceId", "ProjectId"] },
      { source: "src/components/ProjectSummary/ProjectSummary.tsx", target: "src/types/project.ts", names: ["Project", "ProjectSummary", "ProjectStatus", "GitStatus"] },
    ] }),
    edge("dir:src/components/", "dir:src/hooks/", { weight: 18, via: [{ source: "src/components/Terminal/Terminal.tsx", target: "src/hooks/useTerminal.ts", names: ["useTerminal"] }] }),
    edge("dir:src/components/", "dir:src/services/", { weight: 7, via: [{ source: "src/components/Sidebar/Sidebar.tsx", target: "src/services/sessions.ts", names: ["listSessions", "createSession"] }] }),
    edge("dir:src/hooks/", "dir:src/types/", { weight: 12 }),
    edge("dir:src/hooks/", "dir:src/services/", { weight: 4, cycle: true }),
    edge("dir:src/services/", "dir:src/hooks/", { weight: 1, cycle: true }),
    edge("dir:src/services/", "dir:src/types/", { weight: 6 }),
    edge("dir:src/", "dir:src/components/", { weight: 9, via: [{ source: "src/App.tsx", target: "src/components/Sidebar/Sidebar.tsx", names: ["Sidebar"] }] }),
    edge("dir:src/", "dir:src/hooks/", { weight: 3 }),
    edge("dir:src/", "dir:src/types/", { weight: 2 }),
    edge("dir:src/components/", "dir:src-tauri/", { kind: "ipc", weight: 27, names: ["spawn_terminal", "write_terminal", "resize_terminal", "kill_terminal", "list_sessions", "open_workspace", "read_claude_md", "save_layout", "git_status", "list_projects", "watch_folder", "open_in_editor", "copy_path", "session_history", "restore_session", "rename_session", "close_workspace", "pin_project", "unpin_project", "reorder_tabs", "set_theme", "get_settings", "save_settings", "install_skill", "list_skills", "remove_skill", "check_update"] }),
    edge("dir:src/hooks/", "dir:src-tauri/", { kind: "ipc", weight: 12, names: ["spawn_terminal", "write_terminal", "resize_terminal", "kill_terminal", "list_sessions", "session_history", "restore_session", "watch_folder", "git_status", "open_workspace", "read_claude_md", "save_layout"] }),
    edge("dir:src/services/", "dir:src-tauri/", { kind: "ipc", weight: 6, names: ["list_sessions", "create_session", "git_status", "list_projects", "open_in_editor", "copy_path"] }),
    edge("dir:src/", "dir:src-tauri/", { kind: "ipc", weight: 3, names: ["get_settings", "save_settings", "check_update"] }),
  ],
  areas,
  cycles: [["dir:src/hooks/", "dir:src/services/"]],
  counts: { totalCodeFiles: 140, shown: 7, folded: 0, hiddenTests: 49 },
  generatedAt: NOW,
};

// ---------------------------------------------------------------- dir (Level 2): src/components
const A = "dir:src/components/";
const loose = [
  file("src/components/Sidebar/Sidebar.tsx", { area: A, inDegree: 4, outDegree: 6, c30: 3, testedBy: ["src/components/Sidebar/Sidebar.test.tsx"] }),
  file("src/components/Terminal/Terminal.tsx", { area: A, inDegree: 3, outDegree: 9, c30: 6, knowledge: kn(1, 1), testedBy: ["src/components/Terminal/Terminal.test.tsx"] }),
  file("src/components/Terminal/TerminalTabs.tsx", { area: A, inDegree: 2, outDegree: 3, c30: 1, testedBy: ["src/components/Terminal/TerminalTabs.test.tsx"] }),
  file("src/components/StatusBar.tsx", { area: A, inDegree: 2, outDegree: 2, c30: 0 }),
  file("src/components/CommandPalette.tsx", { area: A, inDegree: 1, outDegree: 4, c30: 2, testedBy: ["src/components/CommandPalette.test.tsx"] }),
  file("src/components/SkillsStore.tsx", { area: A, inDegree: 1, outDegree: 3, c30: 4, authors: [["claude", 0.9]] }),
  file("src/components/Settings.tsx", { area: A, inDegree: 1, outDegree: 2, c30: 0 }),
  file("src/components/Layout.tsx", { area: A, inDegree: 6, outDegree: 5, c30: 1 }),
  file("src/components/Sidebar/index.ts", { area: A, inDegree: 3, outDegree: 1, c30: 0 }),
  file("src/components/Terminal/index.ts", { area: A, inDegree: 3, outDegree: 1, c30: 0 }),
  file("src/components/ErrorBoundary.tsx", { area: A, inDegree: 1, outDegree: 0, c30: 0 }),
  file("src/components/Toast.tsx", { area: A, inDegree: 5, outDegree: 0, c30: 0, knowledge: kn(1, 1, 1) }),
];
const subs = [
  dir("src/components/ActivityBar", "ActivityBar", { parent: A, area: A, files: 8, source: 5, tests: 3, documented: 0, tested: 4, history: hist(2), knowledge: kn(0, 1) }),
  dir("src/components/WorkspaceOverview", "WorkspaceOverview", { parent: A, area: A, files: 9, source: 6, tests: 3, documented: 0, tested: 5, history: hist(1), knowledge: kn(0, 1) }),
  dir("src/components/ProjectSummary", "ProjectSummary", { parent: A, area: A, files: 6, source: 4, tests: 2, documented: 0, tested: 2, history: hist(0), knowledge: kn(0, 1) }),
];
const ghost = (side, target, label, hue, files, o = {}) => ({
  id: `ghost:${side}:${target}`, kind: "dir", label, path: target.replace(/^dir:/, "").replace(/\/$/, ""), parent: null, lang: "TypeScript", lines: 0, role: "source",
  area: target, knowledge: kn(o.own ?? 0, 1), tasks: [], inDegree: 0, outDegree: 0, testedBy: [], entry: false, entryKinds: [],
  aggregates: { files, source: files, tests: 0, config: 0, lines: 0, documented: o.documented ?? 0, stale: 0, testedSource: 0, tasks: [], history: hist(o.c30 ?? 1) },
  ghost: true, side, dir: "", noteCount: 0, dirNoteCount: 0,
});
const dirView = {
  level: "dir", root: A,
  nodes: [
    ...subs, ...loose,
    { ...file("src/components/Sidebar/../../lib/format.ts".replace("Sidebar/../../", ""), { area: "dir:src/", inDegree: 0 }), id: "fold:dir:src/components/:loose", kind: "fold", label: "+14 more", path: "src/components", parent: A, foldCount: 14, foldIds: ["src/components/Empty.tsx", "src/components/Spinner.tsx", "src/components/Badge.tsx", "src/components/Kbd.tsx", "src/components/Icon.tsx", "src/components/Tooltip.tsx", "src/components/Menu.tsx", "src/components/Dialog.tsx", "src/components/Tabs.tsx", "src/components/Field.tsx", "src/components/Switch.tsx", "src/components/Avatar.tsx", "src/components/Progress.tsx", "src/components/Card.tsx"] },
    ghost("down", "dir:src/types/", "src/types · 3 files used", 5, 3, { documented: 2 }),
    ghost("down", "dir:src/hooks/", "src/hooks · 4 files used", 4, 4, { documented: 3 }),
    ghost("down", "dir:src/services/", "src/services · 2 files used", 0, 2),
    ghost("up", "dir:src/", "src (other) · 2 files used", 0, 2, { c30: 12 }),
    ghost("down", "dir:src-tauri/", "src-tauri · 9 files used", 3, 9, { documented: 6, own: 1 }),
  ],
  edges: [
    edge("src/components/Layout.tsx", "src/components/Sidebar/index.ts", { names: ["Sidebar"] }),
    edge("src/components/Layout.tsx", "src/components/Terminal/index.ts", { names: ["Terminal", "TerminalTabs"] }),
    edge("src/components/Layout.tsx", "src/components/StatusBar.tsx", { names: ["StatusBar"] }),
    edge("src/components/Layout.tsx", "src/components/CommandPalette.tsx", { names: ["CommandPalette"] }),
    edge("src/components/Layout.tsx", "dir:src/components/ActivityBar/", { names: ["ActivityBar"] }),
    edge("src/components/Sidebar/index.ts", "src/components/Sidebar/Sidebar.tsx", { names: ["default"] }),
    edge("src/components/Terminal/index.ts", "src/components/Terminal/Terminal.tsx", { names: ["default"] }),
    edge("src/components/Terminal/index.ts", "src/components/Terminal/TerminalTabs.tsx", { names: ["TerminalTabs"] }),
    edge("src/components/Terminal/Terminal.tsx", "src/components/Terminal/TerminalTabs.tsx", { names: ["TerminalTabs"] }),
    edge("src/components/Terminal/Terminal.tsx", "src/components/Toast.tsx", { names: ["toast"] }),
    edge("src/components/Sidebar/Sidebar.tsx", "src/components/Toast.tsx", { names: ["toast"] }),
    edge("src/components/Sidebar/Sidebar.tsx", "dir:src/components/WorkspaceOverview/", { names: ["WorkspaceOverview"] }),
    edge("src/components/Sidebar/Sidebar.tsx", "dir:src/components/ProjectSummary/", { names: ["ProjectSummary"] }),
    edge("src/components/CommandPalette.tsx", "src/components/Toast.tsx", { names: ["toast"] }),
    edge("src/components/SkillsStore.tsx", "src/components/Toast.tsx", { names: ["toast"] }),
    edge("src/components/Settings.tsx", "src/components/Toast.tsx", { names: ["toast"] }),
    edge("src/components/StatusBar.tsx", "src/components/Layout.tsx", { names: ["useLayout"], cycle: true }),
    edge("dir:src/components/ActivityBar/", "src/components/Sidebar/index.ts", { weight: 2 }),
    edge("src/components/Terminal/Terminal.tsx", "ghost:down:dir:src/types/", { weight: 21, names: ["TerminalSession", "TerminalEvent", "PtySize", "TerminalTheme", "TerminalId", "ScrollbackLine", "TerminalMode", "TerminalState"], via: [{ source: "src/components/Terminal/Terminal.tsx", target: "src/types/terminal.ts", names: ["TerminalSession", "TerminalEvent", "PtySize"] }] }),
    edge("src/components/Sidebar/Sidebar.tsx", "ghost:down:dir:src/types/", { weight: 14, names: ["TerminalSession", "Workspace", "Project"] }),
    edge("dir:src/components/WorkspaceOverview/", "ghost:down:dir:src/types/", { weight: 6, names: ["Workspace", "WorkspaceProject"] }),
    edge("src/components/Terminal/Terminal.tsx", "ghost:down:dir:src/hooks/", { weight: 9, names: ["useTerminal", "usePty"] }),
    edge("src/components/Sidebar/Sidebar.tsx", "ghost:down:dir:src/hooks/", { weight: 5, names: ["useWorkspace"] }),
    edge("src/components/CommandPalette.tsx", "ghost:down:dir:src/hooks/", { weight: 4, names: ["useCommands"] }),
    edge("src/components/Sidebar/Sidebar.tsx", "ghost:down:dir:src/services/", { weight: 5, names: ["listSessions", "createSession"] }),
    edge("src/components/SkillsStore.tsx", "ghost:down:dir:src/services/", { weight: 2, names: ["fetchSkills"] }),
    edge("ghost:up:dir:src/", "src/components/Layout.tsx", { weight: 7, names: ["Layout"], via: [{ source: "src/App.tsx", target: "src/components/Layout.tsx", names: ["Layout"] }] }),
    edge("ghost:up:dir:src/", "src/components/ErrorBoundary.tsx", { weight: 2, names: ["ErrorBoundary"] }),
    edge("src/components/Terminal/Terminal.tsx", "ghost:down:dir:src-tauri/", { kind: "ipc", weight: 8, names: ["spawn_terminal", "write_terminal", "resize_terminal", "kill_terminal", "session_history", "restore_session", "rename_session", "set_theme"] }),
    edge("src/components/Sidebar/Sidebar.tsx", "ghost:down:dir:src-tauri/", { kind: "ipc", weight: 6, names: ["open_workspace", "read_claude_md", "list_projects", "git_status", "pin_project", "unpin_project"] }),
    edge("src/components/SkillsStore.tsx", "ghost:down:dir:src-tauri/", { kind: "ipc", weight: 3, names: ["install_skill", "list_skills", "remove_skill"] }),
    edge("src/components/Settings.tsx", "ghost:down:dir:src-tauri/", { kind: "ipc", weight: 2, names: ["get_settings", "save_settings"] }),
  ],
  areas,
  cycles: [["src/components/Layout.tsx", "src/components/StatusBar.tsx"]],
  counts: { totalCodeFiles: 140, shown: 15, folded: 14, hiddenTests: 25 },
  generatedAt: NOW,
};
// Fix the accidental spread above: the fold node must be a clean fold node.
dirView.nodes = dirView.nodes.map((n) => (n.kind === "fold" ? { id: n.id, kind: "fold", label: n.label, path: "src/components", parent: A, lang: "", lines: 0, role: "source", area: A, knowledge: kn(), tasks: [], inDegree: 0, outDegree: 0, testedBy: [], entry: false, entryKinds: [], foldCount: n.foldCount, foldIds: n.foldIds, dir: "src/components", noteCount: 0, dirNoteCount: 0 } : n));

// Tests variant (tests=1): the same view plus test files and their `tests` edges, incl. a duplicate basename.
const testFiles = [
  ["src/components/Sidebar/Sidebar.test.tsx", "src/components/Sidebar/Sidebar.tsx"],
  ["src/components/Terminal/Terminal.test.tsx", "src/components/Terminal/Terminal.tsx"],
  ["src/components/Terminal/TerminalTabs.test.tsx", "src/components/Terminal/TerminalTabs.tsx"],
  ["src/components/CommandPalette.test.tsx", "src/components/CommandPalette.tsx"],
  ["src/components/__tests__/Sidebar.test.tsx", "src/components/Sidebar/Sidebar.tsx"],
  ["src/components/Layout.test.tsx", "src/components/Layout.tsx"],
];
const dirTests = structuredClone(dirView);
for (const [t, s] of testFiles) {
  dirTests.nodes.push(file(t, { area: A, role: "test", inDegree: 0, outDegree: 1, knowledge: kn() }));
  dirTests.edges.push(edge(t, s, { kind: "tests", names: ["default"] }));
}
dirTests.counts = { ...dirTests.counts, hiddenTests: 0 };

// ---------------------------------------------------------------- impact (Level 3): packages/reggie/src/paths.ts
const P = "dir:packages/reggie/";
const centre = "packages/reggie/src/paths.ts";
const up1 = ["cli.ts", "serve.ts", "mcp.ts", "graph.ts", "facts.ts", "tasks.ts", "notes.ts", "journal.ts", "capture.ts", "packet.ts", "plan.ts", "context.ts", "people.ts", "config.ts", "git.ts", "onboard.ts", "intake.ts", "claim.ts", "history.ts", "views.ts", "story.ts"].map((b) => `packages/reggie/src/${b}`);
const up2 = ["packages/reggie/src/index.ts", "packages/reggie/src/api.ts"];
const down1 = ["packages/reggie/src/util.ts", "packages/reggie/src/constants.ts"];
const impact = {
  level: "impact", root: centre, center: centre,
  nodes: [
    file(centre, { area: P, inDegree: 21, outDegree: 2, c30: 5, knowledge: kn(0, 2), extra: { hop: 0, side: "both", center: true }, testedBy: ["packages/reggie/src/paths.test.ts"] }),
    ...up1.map((p, i) => file(p, { area: P, inDegree: (i * 7) % 11, outDegree: 3, c30: (i * 3) % 9, knowledge: i % 3 === 0 ? kn(1, 2) : kn(0, 2), extra: { hop: 1, side: "up" }, testedBy: i % 2 ? [`${p.replace(/\.ts$/, ".test.ts")}`] : [] })),
    ...up2.map((p) => file(p, { area: P, inDegree: 1, outDegree: 12, c30: 1, extra: { hop: 2, side: "up" } })),
    ...down1.map((p, i) => file(p, { area: P, inDegree: 9, outDegree: 0, c30: i, knowledge: kn(1, 2), extra: { hop: 1, side: "down" } })),
    { id: "fold:up:dir:src/components/", kind: "fold", label: "+6 more in src/components", path: "src/components", parent: null, lang: "", lines: 0, role: "source", area: "dir:src/components/", knowledge: kn(), tasks: [], inDegree: 0, outDegree: 0, testedBy: [], entry: false, entryKinds: [], side: "up", hop: 2, foldCount: 6, foldIds: ["src/components/Sidebar/Sidebar.tsx", "src/components/Layout.tsx", "src/components/Settings.tsx", "src/components/Toast.tsx", "src/components/StatusBar.tsx", "src/components/SkillsStore.tsx"], dir: "", noteCount: 0, dirNoteCount: 0 },
  ],
  edges: [
    ...up1.map((p, i) => edge(p, centre, { names: i % 4 === 0 ? ["RepoPaths", "resolvePaths"] : i % 4 === 1 ? ["RepoPaths"] : i % 4 === 2 ? ["resolvePaths", "isSafeSlug", "noteFile"] : ["resolvePaths"] })),
    edge("packages/reggie/src/index.ts", "packages/reggie/src/cli.ts", { names: ["run"] }),
    edge("packages/reggie/src/api.ts", "packages/reggie/src/serve.ts", { names: ["startServer", "VENDOR_FILES"] }),
    edge("packages/reggie/src/serve.ts", "packages/reggie/src/graph.ts", { names: ["buildGraph", "RepoGraph"] }),
    edge("fold:up:dir:src/components/", "packages/reggie/src/serve.ts", { weight: 6 }),
    edge(centre, "packages/reggie/src/util.ts", { names: ["slugify", "readText"] }),
    edge(centre, "packages/reggie/src/constants.ts", { names: ["REGGIE_DIR"] }),
    edge("packages/reggie/src/util.ts", centre, { names: ["RepoPaths"], cycle: true }),
  ],
  areas,
  cycles: [[centre, "packages/reggie/src/util.ts"]],
  counts: { totalCodeFiles: 140, shown: 26, folded: 6, hiddenTests: 11, up: [21, 8], down: [2] },
  generatedAt: NOW,
};

// ---------------------------------------------------------------- task blast radius (impact with centers)
const T = "repo-manager-mvp";
const O = "guidebook-ui";
const blast = {
  level: "impact", root: `task:${T}`, centers: ["packages/reggie/src/serve.ts", "packages/reggie/src/graph.ts", "packages/reggie/src/views.ts", "packages/reggie/src/paths.ts", "packages/reggie/ui/app.js"],
  nodes: [
    file("packages/reggie/src/serve.ts", { area: P, inDegree: 2, outDegree: 14, c30: 12, extra: { hop: 0, side: "both", center: true, planned: true, actual: true, task: T, collision: [O] } }),
    file("packages/reggie/src/graph.ts", { area: P, inDegree: 4, outDegree: 6, c30: 8, extra: { hop: 0, side: "both", center: true, planned: true, actual: true, task: T } }),
    file("packages/reggie/src/views.ts", { area: P, inDegree: 2, outDegree: 2, c30: 3, extra: { hop: 0, side: "both", center: true, planned: true, actual: false, task: T } }),
    file("packages/reggie/src/paths.ts", { area: P, inDegree: 21, outDegree: 2, c30: 5, extra: { hop: 0, side: "both", center: true, planned: false, actual: true, task: T } }),
    file("packages/reggie/ui/app.js", { area: P, inDegree: 3, outDegree: 0, c30: 20, extra: { hop: 0, side: "both", center: true, planned: true, actual: true, task: O, collision: [T] } }),
    file("packages/reggie/ui/map.js", { area: P, inDegree: 2, outDegree: 0, c30: 15, extra: { hop: 1, side: "up", task: O } }),
    file("packages/reggie/src/cli.ts", { area: P, inDegree: 1, outDegree: 12, c30: 4, extra: { hop: 1, side: "up" } }),
    file("packages/reggie/src/mcp.ts", { area: P, inDegree: 1, outDegree: 9, c30: 1, extra: { hop: 1, side: "up" } }),
    file("packages/reggie/src/story.ts", { area: P, inDegree: 1, outDegree: 4, c30: 2, extra: { hop: 1, side: "up" } }),
    file("packages/reggie/src/index.ts", { area: P, inDegree: 0, outDegree: 3, c30: 0, extra: { hop: 2, side: "up" } }),
    file("packages/reggie/src/graph.test.ts", { area: P, role: "test", inDegree: 0, outDegree: 1, c30: 2, extra: { hop: 1, side: "up" } }),
    file("src/components/Sidebar/Sidebar.tsx", { area: A, inDegree: 4, outDegree: 6, c30: 3, extra: { hop: 1, side: "up" } }),
  ],
  edges: [
    edge("packages/reggie/src/serve.ts", "packages/reggie/src/graph.ts", { names: ["buildGraph", "RepoGraph"] }),
    edge("packages/reggie/src/serve.ts", "packages/reggie/src/views.ts", { names: ["containerView", "dirView"] }),
    edge("packages/reggie/src/serve.ts", "packages/reggie/src/paths.ts", { names: ["RepoPaths"] }),
    edge("packages/reggie/src/graph.ts", "packages/reggie/src/paths.ts", { names: ["RepoPaths", "resolvePaths"] }),
    edge("packages/reggie/src/views.ts", "packages/reggie/src/graph.ts", { names: ["RepoGraph"] }),
    edge("packages/reggie/src/cli.ts", "packages/reggie/src/serve.ts", { names: ["startServer"] }),
    edge("packages/reggie/src/cli.ts", "packages/reggie/src/paths.ts", { names: ["resolvePaths"] }),
    edge("packages/reggie/src/mcp.ts", "packages/reggie/src/graph.ts", { names: ["buildGraph"] }),
    edge("packages/reggie/src/story.ts", "packages/reggie/src/views.ts", { names: ["containerView"] }),
    edge("packages/reggie/src/index.ts", "packages/reggie/src/cli.ts", { names: ["run"] }),
    edge("packages/reggie/src/graph.test.ts", "packages/reggie/src/graph.ts", { kind: "tests", names: ["buildGraph"] }),
    edge("packages/reggie/ui/map.js", "packages/reggie/ui/app.js", { names: ["storage"] }),
    edge("src/components/Sidebar/Sidebar.tsx", "packages/reggie/src/paths.ts", { names: ["RepoPaths"], confidence: "heuristic" }),
    edge("task:repo-manager-mvp", "packages/reggie/src/serve.ts", { kind: "touches" }),
  ],
  areas,
  cycles: [],
  counts: { totalCodeFiles: 140, shown: 12, folded: 0, hiddenTests: 4, up: [7, 1], down: [0] },
  generatedAt: NOW,
};

// ---------------------------------------------------------------- workspace (Level 0): raw /api/workspace payload
const workspace = {
  name: "Reggie Workspace", root: "/Users/jacobpress/Desktop/Projects/Reggie Workspace", single: false,
  repos: [
    { name: "reggie", path: "/Users/jacobpress/Desktop/Projects/Reggie Workspace/reggie", description: "The Reggie agent system.", primaryLanguage: "TypeScript", codeFiles: 140, branch: "repo-manager", taskCounts: { ungroomed: 1, groomed: 0, planned: 0, "in-process": 1, "awaiting-decision": 0, done: 3 }, knowledge: { source: 92, noted: 21, inherited: 40, stale: 1 }, lastJournal: null, entryPoints: ["packages/reggie/src/cli.ts"], needsYou: [] },
    { name: "forge-reggie", path: "/Users/jacobpress/Desktop/Projects/Reggie Workspace/forge-reggie", description: "Forge desktop app.", primaryLanguage: "TypeScript", codeFiles: 96, branch: "main", taskCounts: { ungroomed: 0, groomed: 2, planned: 1, "in-process": 0, "awaiting-decision": 1, done: 8 }, knowledge: { source: 70, noted: 5, inherited: 12, stale: 0 }, lastJournal: null, entryPoints: ["src/main.tsx"], needsYou: [] },
    { name: "color-lock", path: "/x/color-lock", description: "Puzzle game backend.", primaryLanguage: "Swift", codeFiles: 210, branch: "main", taskCounts: { ungroomed: 0, groomed: 0, planned: 0, "in-process": 0, "awaiting-decision": 0, done: 0 }, knowledge: { source: 180, noted: 0, inherited: 0, stale: 0 }, lastJournal: null, entryPoints: [], needsYou: [] },
  ],
  edges: [
    { source: "forge-reggie", target: "reggie", kind: "depends-on", via: "reggie" },
    { source: "forge-reggie", target: "reggie", kind: "same-org", via: "The-Banana-Standard" },
    { source: "reggie", target: "color-lock", kind: "same-org", via: "The-Banana-Standard" },
  ],
};

const out = { "sample-container.json": container, "sample-dir.json": dirView, "sample-dir-tests.json": dirTests, "sample-impact.json": impact, "sample-blast.json": blast, "sample-workspace.json": workspace };
for (const [name, value] of Object.entries(out)) writeFileSync(join(here, name), `${JSON.stringify(value, null, 2)}\n`);
console.log(Object.keys(out).join("\n"));
