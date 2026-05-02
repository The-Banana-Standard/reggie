export type TaskPriority = "P1" | "P2" | "P3";
export type TaskComplexity = "simple" | "moderate" | "complex";
export type TaskPipeline = "code" | "design" | "manual" | "reggie-system" | "debug";

export interface TaskItem {
  slug: string;
  description: string;
  priority: TaskPriority | null;
  complexity: TaskComplexity | null;
  pipeline: TaskPipeline | null;
  depends: string[];
  conflicts: string[];
  planned: boolean;
  checked: boolean;
  filesLine: string | null;
}

export interface TaskSection {
  title: string;
  tasks: TaskItem[];
}

export interface ParsedTasks {
  groomed: TaskSection[];
  ungroomed: TaskItem[];
  laterFeatures: TaskItem[];
  active: TaskItem[];
}

const PRIORITY_RE = /\[P([123])\]/;
const COMPLEXITY_RE = /\[(simple|moderate|complex)\]/;
const PIPELINE_RE = /\[(code|design|manual|reggie-system|debug)\]/;
const DEPENDS_RE = /\[depends:\s*([^\]]+)\]/;
const CONFLICTS_RE = /\[conflicts:\s*([^\]]+)\]/;
const PLANNED_RE = /\[planned\]/;
const TASK_LINE_RE = /^- \[([ xX])\]\s+(\S+?):\s+(.+)$/;
const BARE_DASH_RE = /^- (.+)$/;
const LATER_FEATURES_HEADING = "later features";

function toKebabSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60) || "untitled";
}

function parseTaskLine(line: string): TaskItem | null {
  const match = line.match(TASK_LINE_RE);
  if (!match) return null;

  const checked = match[1] !== " ";
  const slug = match[2];
  const rest = match[3];

  const priorityMatch = rest.match(PRIORITY_RE);
  const complexityMatch = rest.match(COMPLEXITY_RE);
  const pipelineMatch = rest.match(PIPELINE_RE);
  const dependsMatch = rest.match(DEPENDS_RE);
  const conflictsMatch = rest.match(CONFLICTS_RE);
  const planned = PLANNED_RE.test(rest);

  // Description is everything before the first tag bracket
  let description = rest;
  const firstBracket = rest.indexOf("[");
  if (firstBracket > 0) {
    description = rest.substring(0, firstBracket).trim();
  }

  return {
    slug,
    description,
    priority: priorityMatch ? (`P${priorityMatch[1]}` as TaskPriority) : null,
    complexity: complexityMatch ? (complexityMatch[1] as TaskComplexity) : null,
    pipeline: pipelineMatch ? (pipelineMatch[1] as TaskPipeline) : null,
    depends: dependsMatch ? dependsMatch[1].split(",").map((s) => s.trim()) : [],
    conflicts: conflictsMatch ? conflictsMatch[1].split(",").map((s) => s.trim()) : [],
    planned,
    checked,
    filesLine: null,
  };
}

function parseBareDashLine(line: string): TaskItem | null {
  const match = line.match(BARE_DASH_RE);
  if (!match) return null;

  const text = match[1].trim();
  if (!text) return null;

  return {
    slug: toKebabSlug(text),
    description: text,
    priority: null,
    complexity: null,
    pipeline: null,
    depends: [],
    conflicts: [],
    planned: false,
    checked: false,
    filesLine: null,
  };
}

export function parseTasksMd(content: string): ParsedTasks {
  const result: ParsedTasks = { groomed: [], ungroomed: [], laterFeatures: [], active: [] };
  if (!content || !content.trim()) return result;

  const lines = content.split("\n");
  let inBacklog = false;
  let inActive = false;
  let inLaterFeatures = false;
  let currentSection: TaskSection | null = null;
  let currentSectionTitle: string | null = null;
  let lastTask: TaskItem | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect ## headings
    if (trimmed.startsWith("## ")) {
      const heading = trimmed.substring(3).trim().toLowerCase();
      inBacklog = heading === "backlog";
      inActive = !inBacklog && heading.includes("active");
      inLaterFeatures = false;
      currentSection = null;
      currentSectionTitle = null;
      lastTask = null;
      continue;
    }

    // Detect ### sub-headings (section groups within backlog)
    if (trimmed.startsWith("### ") && inBacklog) {
      const title = trimmed.substring(4).trim();
      inLaterFeatures = title.toLowerCase() === LATER_FEATURES_HEADING;
      currentSection = null;
      currentSectionTitle = title;
      lastTask = null;
      continue;
    }

    // Parse structured task lines (checkbox + slug: description)
    const task = parseTaskLine(trimmed);
    if (task) {
      // Defense-in-depth: never surface checked tasks to the UI. The
      // delete-on-complete migration semantics mean `[x]` rows should not
      // exist in TASKS.md anymore, but if one slips through (stale from
      // before the migration, or hand-edited), drop it from every output
      // bucket. Still update `lastTask` so any indented `files: ...`
      // continuation line attaches to the right context.
      if (task.checked) {
        lastTask = task;
        continue;
      }
      if (inActive) {
        result.active.push(task);
        lastTask = task;
      } else if (inBacklog) {
        if (inLaterFeatures) {
          result.laterFeatures.push(task);
        } else if (task.planned) {
          // Groomed: preserve section grouping
          if (!currentSection || currentSection.title !== (currentSectionTitle ?? "Uncategorized")) {
            currentSection = { title: currentSectionTitle ?? "Uncategorized", tasks: [] };
            result.groomed.push(currentSection);
          }
          currentSection.tasks.push(task);
        } else {
          // Ungroomed: flat list
          result.ungroomed.push(task);
        }
        lastTask = task;
      }
      continue;
    }

    // Parse bare-dash lines (- some text, no checkbox/slug format)
    if (inBacklog && trimmed.startsWith("- ")) {
      const bareTask = parseBareDashLine(trimmed);
      if (bareTask) {
        if (inLaterFeatures) {
          result.laterFeatures.push(bareTask);
        } else {
          result.ungroomed.push(bareTask);
        }
        lastTask = bareTask;
        continue;
      }
    }

    // Detect indented files: line beneath a task
    if (lastTask && trimmed.startsWith("files:")) {
      lastTask.filesLine = trimmed.substring(6).trim();
      continue;
    }

    // Empty line resets lastTask context for files detection
    if (trimmed === "") {
      lastTask = null;
    }
  }

  return result;
}
