use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_git_repo: bool,
    pub has_claude_md: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResultEntry {
    pub name: String,
    pub path: String,
    pub is_workspace: bool,
    pub is_git_repo: bool,
    pub has_claude_md: bool,
    pub children: Vec<DirectoryEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub tech_stack: Vec<String>,
    pub claude_md: Option<String>,
    pub tasks_md: Option<String>,
    pub readme_excerpt: Option<String>,
    pub is_git_repo: bool,
    pub git_branch: Option<String>,
    pub last_commit: Option<String>,
}

/// Directories to skip during recursive traversal (heavy or non-project dirs).
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "build",
    "dist",
    "vendor",
    "__pycache__",
    "venv",
];

/// Recursively find all git repos under `dir`, skipping hidden dirs, symlinks,
/// and heavy directories. Returns a flat list of `DirectoryEntry` for each
/// directory that contains a `.git` folder.
fn find_git_repos(dir: &Path) -> Vec<DirectoryEntry> {
    let mut repos: Vec<DirectoryEntry> = Vec::new();
    find_git_repos_recursive(dir, &mut repos);
    repos.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    repos
}

fn find_git_repos_recursive(dir: &Path, repos: &mut Vec<DirectoryEntry>) {
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let entry_path = entry.path();

        // Do not follow symlinks to prevent infinite recursion
        if entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(false) {
            continue;
        }

        if !entry_path.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden directories
        if name.starts_with('.') {
            continue;
        }

        // Skip known heavy directories
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        if entry_path.join(".git").exists() {
            // Found a git repo — add it and don't recurse deeper
            repos.push(DirectoryEntry {
                path: entry_path.to_string_lossy().to_string(),
                is_git_repo: true,
                has_claude_md: entry_path.join("CLAUDE.md").exists(),
                name,
            });
        } else {
            // Not a git repo — recurse deeper
            find_git_repos_recursive(&entry_path, repos);
        }
    }
}

/// List visible (non-hidden) subdirectories of `dir`, sorted alphabetically.
fn list_subdirs(dir: &Path) -> Result<Vec<DirectoryEntry>, String> {
    let read_dir = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut entries: Vec<DirectoryEntry> = Vec::new();
    for entry in read_dir.flatten() {
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        entries.push(DirectoryEntry {
            path: entry_path.to_string_lossy().to_string(),
            is_git_repo: entry_path.join(".git").exists(),
            has_claude_md: entry_path.join("CLAUDE.md").exists(),
            name,
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
pub fn scan_workspace(workspace_path: String) -> Result<Vec<DirectoryEntry>, String> {
    let path = PathBuf::from(&workspace_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", workspace_path));
    }
    list_subdirs(&path)
}

/// Scan a top-level "All Projects" folder with recursive git repo detection.
/// For each top-level subdirectory:
/// - If it has `.git` → it's a standalone repo (isWorkspace=false, isGitRepo=true)
/// - Otherwise → recursively search for descendant git repos.
///   If any are found, treat this top-level dir as a workspace with those repos as children.
/// - If neither → skip it
///
/// Hidden directories, symlinks, and heavy directories (node_modules, target, etc.)
/// are skipped at all levels to keep traversal fast.
#[tauri::command]
pub fn scan_all_projects(folder_path: String) -> Result<Vec<ScanResultEntry>, String> {
    let path = PathBuf::from(&folder_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", folder_path));
    }

    let top_level = list_subdirs(&path)?;
    let mut entries: Vec<ScanResultEntry> = Vec::new();

    for dir in top_level {
        let dir_path = PathBuf::from(&dir.path);

        if dir.is_git_repo {
            // Standalone repo at top level
            entries.push(ScanResultEntry {
                name: dir.name,
                path: dir.path,
                is_workspace: false,
                is_git_repo: true,
                has_claude_md: dir.has_claude_md,
                children: Vec::new(),
            });
        } else {
            // Recursively find all git repos under this directory
            let children = find_git_repos(&dir_path);

            if !children.is_empty() {
                entries.push(ScanResultEntry {
                    name: dir.name,
                    path: dir.path,
                    is_workspace: true,
                    is_git_repo: false,
                    has_claude_md: dir.has_claude_md,
                    children,
                });
            }
        }
    }

    Ok(entries)
}

#[tauri::command]
pub fn get_project_info(project_path: String) -> Result<ProjectInfo, String> {
    let path = PathBuf::from(&project_path);
    let name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // Detect tech stack from config files
    let mut tech_stack: Vec<String> = Vec::new();
    let mut description: Option<String> = None;

    // package.json → Node/JS project
    let pkg_json = path.join("package.json");
    if pkg_json.exists() {
        if let Ok(content) = fs::read_to_string(&pkg_json) {
            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                // Get description
                if let Some(desc) = pkg.get("description").and_then(|d| d.as_str()) {
                    if !desc.is_empty() {
                        description = Some(desc.to_string());
                    }
                }
                // Detect frameworks
                let all_deps = merge_deps(&pkg);
                if deps_has(&all_deps, "next") { tech_stack.push("Next.js".into()); }
                else if deps_has(&all_deps, "react") { tech_stack.push("React".into()); }
                if deps_has(&all_deps, "vue") { tech_stack.push("Vue".into()); }
                if deps_has(&all_deps, "svelte") { tech_stack.push("Svelte".into()); }
                if deps_has(&all_deps, "express") { tech_stack.push("Express".into()); }
                if deps_has(&all_deps, "tailwindcss") { tech_stack.push("Tailwind".into()); }
                if deps_has(&all_deps, "typescript") { tech_stack.push("TypeScript".into()); }
                else { tech_stack.push("JavaScript".into()); }
                if deps_has(&all_deps, "firebase") || deps_has(&all_deps, "firebase-admin") {
                    tech_stack.push("Firebase".into());
                }
                if deps_has(&all_deps, "@tauri-apps/api") { tech_stack.push("Tauri".into()); }
            }
        }
    }

    // Cargo.toml → Rust project
    if path.join("Cargo.toml").exists() {
        tech_stack.push("Rust".into());
    }

    // Podfile / .xcodeproj → iOS
    if path.join("Podfile").exists() || has_extension_in_dir(&path, "xcodeproj") {
        tech_stack.push("iOS".into());
    }

    // build.gradle → Android
    if path.join("build.gradle").exists() || path.join("build.gradle.kts").exists() {
        tech_stack.push("Android".into());
    }

    // requirements.txt / pyproject.toml → Python
    if path.join("requirements.txt").exists() || path.join("pyproject.toml").exists() {
        tech_stack.push("Python".into());
    }

    // go.mod → Go
    if path.join("go.mod").exists() {
        tech_stack.push("Go".into());
    }

    // Read CLAUDE.md
    let claude_md = read_file_truncated(&path.join("CLAUDE.md"), 2000);

    // Read TASKS.md
    let tasks_md = read_file_truncated(&path.join("TASKS.md"), 3000);

    // Read README excerpt for description fallback
    let readme_excerpt = read_readme_excerpt(&path);
    if description.is_none() {
        description = readme_excerpt.clone();
    }

    // Git info
    let is_git_repo = path.join(".git").exists();
    let mut git_branch: Option<String> = None;
    let mut last_commit: Option<String> = None;

    if is_git_repo {
        // Read current branch
        let head_file = path.join(".git/HEAD");
        if let Ok(head) = fs::read_to_string(&head_file) {
            let head = head.trim();
            if let Some(branch) = head.strip_prefix("ref: refs/heads/") {
                git_branch = Some(branch.to_string());
            }
        }
        // Read last commit message from COMMIT_EDITMSG or logs
        let commit_msg = path.join(".git/COMMIT_EDITMSG");
        if let Ok(msg) = fs::read_to_string(&commit_msg) {
            let first_line = msg.lines().next().unwrap_or("").trim().to_string();
            if !first_line.is_empty() {
                last_commit = Some(first_line);
            }
        }
    }

    Ok(ProjectInfo {
        name,
        path: project_path,
        description,
        tech_stack,
        claude_md,
        tasks_md,
        readme_excerpt,
        is_git_repo,
        git_branch,
        last_commit,
    })
}

fn merge_deps(pkg: &serde_json::Value) -> std::collections::HashSet<String> {
    let mut deps = std::collections::HashSet::new();
    for key in &["dependencies", "devDependencies"] {
        if let Some(obj) = pkg.get(key).and_then(|d| d.as_object()) {
            for k in obj.keys() {
                deps.insert(k.clone());
            }
        }
    }
    deps
}

fn deps_has(deps: &std::collections::HashSet<String>, name: &str) -> bool {
    deps.contains(name)
}

fn has_extension_in_dir(path: &Path, ext: &str) -> bool {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Some(e) = entry.path().extension() {
                if e == ext {
                    return true;
                }
            }
        }
    }
    false
}

fn read_file_truncated(path: &Path, max_bytes: usize) -> Option<String> {
    if !path.exists() {
        return None;
    }
    match fs::read_to_string(path) {
        Ok(content) => {
            if content.trim().is_empty() {
                None
            } else if content.len() > max_bytes {
                // Find the largest valid char boundary at or before max_bytes
                let truncated = &content[..content.floor_char_boundary(max_bytes)];
                Some(truncated.to_string())
            } else {
                Some(content)
            }
        }
        Err(_) => None,
    }
}

fn read_readme_excerpt(path: &Path) -> Option<String> {
    for name in &["README.md", "readme.md", "README.MD", "README"] {
        let readme = path.join(name);
        if readme.exists() {
            if let Ok(content) = fs::read_to_string(&readme) {
                // Extract first meaningful paragraph after the title
                let lines = content.lines();
                let mut found_title = false;
                let mut excerpt = String::new();

                for line in lines {
                    let trimmed = line.trim();
                    // Skip title lines
                    if trimmed.starts_with('#') {
                        found_title = true;
                        continue;
                    }
                    // Skip badges, empty lines after title
                    if trimmed.is_empty() || trimmed.starts_with('[') || trimmed.starts_with('!') {
                        if found_title && !excerpt.is_empty() {
                            break;
                        }
                        continue;
                    }
                    if found_title || excerpt.is_empty() {
                        if !excerpt.is_empty() {
                            excerpt.push(' ');
                        }
                        excerpt.push_str(trimmed);
                        if excerpt.len() > 300 {
                            break;
                        }
                    }
                }
                if !excerpt.is_empty() {
                    return Some(excerpt);
                }
            }
        }
    }
    None
}

// --- Parallelizable tasks ---

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEntry {
    pub slug: String,
    pub description: String,
    pub priority: u8,
    pub depends: Vec<String>,
    pub conflicts: Vec<String>,
    pub planned: bool,
    pub checked: bool,
    pub tier: Option<String>,
    /// Mode tag: "code", "design", "manual", "reggie-system", "debug", or None.
    pub mode: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParallelizableTaskSlug {
    pub slug: String,
    pub tier: Option<String>,
    /// Mode tag carried through from the parsed task; None for active-task slugs.
    pub mode: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParallelizableTasksResult {
    /// Slugs already running as `### header` blocks under `## Active Tasks`.
    /// These never feed the conflict prune below and are intentionally not
    /// re-launched by the frontend — they are surfaced so callers know what
    /// is in flight (e.g. for cap math).
    pub active_slugs: Vec<ParallelizableTaskSlug>,
    /// Backlog candidates the frontend may launch, after dependency and
    /// (backlog-vs-backlog) conflict pruning.
    pub backlog_slugs: Vec<ParallelizableTaskSlug>,
    pub total_groomed: usize,
}

/// Read `HISTORY.md` (sibling of TASKS.md) and return the set of completed slugs.
/// Returns an empty set if the file is missing or unreadable.
///
/// HISTORY.md uses `- [x] <slug> <description> -- <date>` (no colon after slug),
/// distinct from TASKS.md's `- [x] <slug>: <description> [tags]` format. The slug
/// is the first whitespace-delimited token; a trailing colon is tolerated so this
/// helper also accepts TASKS.md-shaped lines if HISTORY.md ever borrows that format.
fn read_history_md_slugs(repo_path: &Path) -> HashSet<String> {
    let history_path = repo_path.join("HISTORY.md");
    let content = match fs::read_to_string(&history_path) {
        Ok(c) => c,
        Err(_) => return HashSet::new(),
    };
    let mut slugs = HashSet::new();
    for line in content.lines() {
        let trimmed = line.trim();
        let rest = match trimmed
            .strip_prefix("- [x] ")
            .or_else(|| trimmed.strip_prefix("- [X] "))
        {
            Some(r) => r,
            None => continue,
        };
        let first_token = rest.split_whitespace().next().unwrap_or("");
        let slug = first_token.trim_end_matches(':');
        if is_safe_slug(slug) {
            slugs.insert(slug.to_string());
        }
    }
    slugs
}

/// Parse a single task line into a TaskEntry, or None if it doesn't match.
fn parse_task_line(line: &str) -> Option<TaskEntry> {
    let trimmed = line.trim();

    let (checked, rest) = if let Some(rest) = trimmed.strip_prefix("- [x] ").or_else(|| trimmed.strip_prefix("- [X] ")) {
        (true, rest)
    } else if let Some(rest) = trimmed.strip_prefix("- [ ] ") {
        (false, rest)
    } else {
        return None;
    };

    // Try slug: description format (colon separator), else informal checkbox task
    let (slug, description, tag_source_owned) = if let Some(colon_pos) = rest.find(':') {
        let slug = rest[..colon_pos].trim().to_string();
        if !is_safe_slug(&slug) {
            return None;
        }
        let after_colon = &rest[colon_pos + 1..];
        let description = match after_colon.find('[') {
            Some(bracket_pos) => after_colon[..bracket_pos].trim().to_string(),
            None => after_colon.trim().to_string(),
        };
        (slug, description, after_colon.to_string())
    } else {
        // No colon — informal checkbox task, generate slug from text.
        // to_kebab_case uses c.is_alphanumeric() which already excludes control chars
        // by construction; no additional validation needed.
        let description = match rest.find('[') {
            Some(bracket_pos) => rest[..bracket_pos].trim().to_string(),
            None => rest.trim().to_string(),
        };
        let slug = to_kebab_case(&description);
        if slug.is_empty() {
            return None;
        }
        (slug, description, rest.to_string())
    };

    // Parse tags in square brackets
    let mut priority: u8 = 2;
    let mut depends: Vec<String> = Vec::new();
    let mut conflicts: Vec<String> = Vec::new();
    let mut planned = false;
    let mut tier: Option<String> = None;
    let mut mode: Option<String> = None;

    let mut search_from = 0usize;
    let tag_source = &tag_source_owned;
    while let Some(open) = tag_source[search_from..].find('[') {
        let open_abs = search_from + open;
        if let Some(close) = tag_source[open_abs..].find(']') {
            let close_abs = open_abs + close;
            let tag_content = &tag_source[open_abs + 1..close_abs];

            match tag_content {
                "P1" => priority = 1,
                "P2" => priority = 2,
                "P3" => priority = 3,
                "planned" => planned = true,
                _ if tag_content.starts_with("depends:") => {
                    let vals = &tag_content["depends:".len()..];
                    depends = vals.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                }
                _ if tag_content.starts_with("conflicts:") => {
                    let vals = &tag_content["conflicts:".len()..];
                    conflicts = vals.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                }
                _ if tag_content.starts_with("tier:") => {
                    let val = tag_content["tier:".len()..].trim();
                    if !val.is_empty() {
                        tier = Some(val.to_string());
                    }
                }
                "code" | "design" | "manual" | "reggie-system" | "debug" => {
                    mode = Some(tag_content.to_string());
                }
                _ => {}
            }

            search_from = close_abs + 1;
        } else {
            break;
        }
    }

    Some(TaskEntry {
        slug,
        description,
        priority,
        depends,
        conflicts,
        planned,
        checked,
        tier,
        mode,
    })
}

#[tauri::command]
pub fn get_parallelizable_tasks(project_path: String) -> Result<ParallelizableTasksResult, String> {
    use std::collections::{HashMap, HashSet};

    let tasks_path = Path::new(&project_path).join("TASKS.md");
    let content = fs::read_to_string(&tasks_path)
        .map_err(|e| format!("Failed to read TASKS.md: {}", e))?;

    // Collect all checked slugs (for dependency resolution).
    // Source 1: TASKS.md `[x]` lines — covers stale `[x]` lines that may still
    // linger from before the delete-on-complete migration semantics.
    // Source 2: HISTORY.md `[x]` lines — the post-migration source of truth
    // for completed work. Without this, every dep on historical work would
    // silently block once `meta: complete` stops leaving `[x]` rows in TASKS.md.
    let mut checked_slugs: HashSet<String> = content
        .lines()
        .filter_map(parse_task_line)
        .filter(|t| t.checked)
        .map(|t| t.slug)
        .collect();
    checked_slugs.extend(read_history_md_slugs(Path::new(&project_path)));

    // Build a slug -> mode map by parsing every task line in the entire file.
    // This is intentionally NOT section-gated: the original tagged entry for
    // an active slug typically lives outside `## Active Tasks` (e.g. checked
    // off in `## Done` or still listed in `## Backlog`). We use this map only
    // to populate `mode` on active slugs — backlog mode flows through
    // `parse_task_line` directly.
    let slug_to_mode: HashMap<String, Option<String>> = content
        .lines()
        .filter_map(parse_task_line)
        .map(|t| (t.slug, t.mode))
        .collect();

    // First pass: collect active task slugs from ## Active Tasks section (### headers).
    // Mode is filled in via the cross-reference map above; falls back to None
    // when no original entry survives in the file.
    let mut active_slugs: Vec<ParallelizableTaskSlug> = Vec::new();
    {
        let mut in_active = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("## ") {
                if trimmed.starts_with("## Active Tasks") {
                    in_active = true;
                } else if in_active {
                    break;
                }
                continue;
            }
            if trimmed == "---" && in_active {
                break;
            }
            if in_active && trimmed.starts_with("### ") {
                let slug = trimmed["### ".len()..].trim().to_string();
                if is_safe_slug(&slug) {
                    let mode = slug_to_mode.get(&slug).cloned().unwrap_or(None);
                    active_slugs.push(ParallelizableTaskSlug {
                        slug,
                        tier: None,
                        mode,
                    });
                }
            }
        }
    }

    // Find the backlog section and parse tasks from it
    let mut in_backlog = false;
    let mut backlog_tasks: Vec<TaskEntry> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        // Detect section headings (## level only)
        if trimmed.starts_with("## ") {
            if trimmed.starts_with("## Backlog") {
                in_backlog = true;
            } else if in_backlog {
                break; // End of backlog section
            }
            continue;
        }

        if in_backlog {
            if let Some(task) = parse_task_line(line) {
                backlog_tasks.push(task);
            }
        }
    }

    // Filter to planned, unchecked tasks. Exclude manual-mode tasks: they require
    // human-in-the-loop walk-through and must not be auto-dispatched.
    let groomed: Vec<&TaskEntry> = backlog_tasks
        .iter()
        .filter(|t| t.planned && !t.checked && t.mode.as_deref() != Some("manual"))
        .collect();
    let total_groomed = groomed.len();

    // Filter to ready tasks (all dependencies satisfied)
    let mut ready: Vec<&TaskEntry> = groomed
        .into_iter()
        .filter(|t| t.depends.iter().all(|dep| checked_slugs.contains(dep)))
        .collect();

    // Sort by priority (P1=1 first)
    ready.sort_by_key(|t| t.priority);

    // Backlog-only conflict prune.
    //
    // Active slugs never feed the conflict prune; cross-domain backlog conflicts
    // are intentionally preserved. Earlier this loop seeded `selected` with
    // `active_slugs`, which silently dropped any backlog task that listed an
    // active slug in its `[conflicts: ...]` tag (the cross-domain dispatch
    // bug investigated in `.pipeline/investigate-cross-domain-batch-start`).
    // Restricting to backlog-vs-backlog fixes that without weakening the
    // user-authored conflict semantics within backlog.
    let mut selected: Vec<ParallelizableTaskSlug> = Vec::new();
    let mut selected_conflicts: HashSet<String> = HashSet::new();

    for task in &ready {
        // Check if this task's slug is in any already-selected task's conflicts
        if selected_conflicts.contains(&task.slug) {
            continue;
        }

        // Check if any already-selected slug is in this task's conflicts
        if task.conflicts.iter().any(|c| selected.iter().any(|s| s.slug == *c)) {
            continue;
        }

        // Add the task
        selected.push(ParallelizableTaskSlug {
            slug: task.slug.clone(),
            tier: task.tier.clone(),
            mode: task.mode.clone(),
        });
        for c in &task.conflicts {
            selected_conflicts.insert(c.clone());
        }
    }

    Ok(ParallelizableTasksResult {
        active_slugs,
        backlog_slugs: selected,
        total_groomed,
    })
}

// --- Scan tasks across repos ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItemSummary {
    pub slug: String,
    pub description: String,
    /// Mode tag from the parsed task: "code" | "design" | "manual" | "reggie-system" | "debug" | None.
    /// Always None for active tasks (parsed from `### header` lines, where tag info is absent).
    pub mode: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoTaskSummary {
    pub name: String,
    pub path: String,
    pub workspace_name: Option<String>,
    pub ungroomed_count: usize,
    pub groomed_count: usize,
    pub active_count: usize,
    pub ungroomed_tasks: Vec<TaskItemSummary>,
    pub groomed_tasks: Vec<TaskItemSummary>,
    pub active_tasks: Vec<TaskItemSummary>,
}

#[derive(Default)]
struct ParsedTasks {
    ungroomed_count: usize,
    groomed_count: usize,
    active_count: usize,
    ungroomed_tasks: Vec<TaskItemSummary>,
    groomed_tasks: Vec<TaskItemSummary>,
    active_tasks: Vec<TaskItemSummary>,
}

/// Parse a TASKS.md file and return counts of ungroomed, groomed, and active tasks.
/// Used by tests that only need counts.
#[cfg(test)]
fn count_tasks_in_file(content: &str) -> (usize, usize, usize) {
    let parsed = parse_tasks_in_file(content);
    (parsed.ungroomed_count, parsed.groomed_count, parsed.active_count)
}

/// Parse a TASKS.md file and return counts and individual task items.
fn parse_tasks_in_file(content: &str) -> ParsedTasks {
    let mut result = ParsedTasks {
        ungroomed_count: 0,
        groomed_count: 0,
        active_count: 0,
        ungroomed_tasks: Vec::new(),
        groomed_tasks: Vec::new(),
        active_tasks: Vec::new(),
    };

    let mut current_section = "";
    let mut current_subsection = "";

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("## ") {
            current_section = if trimmed.starts_with("## Active") {
                "active"
            } else if trimmed.starts_with("## Backlog") {
                "backlog"
            } else {
                ""
            };
            current_subsection = "";
            continue;
        }

        if let Some(header) = trimmed.strip_prefix("### ") {
            // In the Active section, each ### header is a task slug
            if current_section == "active" {
                result.active_count += 1;
                let slug = header.trim().to_string();
                if !slug.is_empty() {
                    result.active_tasks.push(TaskItemSummary {
                        description: String::new(),
                        slug,
                        mode: None,
                    });
                }
            }
            current_subsection = if header.starts_with("Ungroomed") {
                "ungroomed"
            } else {
                "other"
            };
            continue;
        }

        if let Some(task) = parse_task_line(line) {
            if task.checked {
                continue;
            }
            if current_section == "backlog" {
                if current_subsection == "ungroomed" || !task.planned {
                    result.ungroomed_count += 1;
                    result.ungroomed_tasks.push(TaskItemSummary {
                        slug: task.slug,
                        description: task.description,
                        mode: task.mode,
                    });
                } else {
                    result.groomed_count += 1;
                    result.groomed_tasks.push(TaskItemSummary {
                        slug: task.slug,
                        description: task.description,
                        mode: task.mode,
                    });
                }
            }
        } else if current_section == "backlog" && current_subsection == "ungroomed" {
            // Bare-dash lines (e.g. "- Fix the auth bug") in Ungroomed are brain-dump entries
            if let Some(text) = trimmed.strip_prefix("- ") {
                if !text.starts_with("[ ] ") && !text.starts_with("[x] ") && !text.starts_with("[X] ") {
                    let slug = to_kebab_case(text);
                    if !slug.is_empty() {
                        result.ungroomed_count += 1;
                        result.ungroomed_tasks.push(TaskItemSummary {
                            slug,
                            description: text.to_string(),
                            mode: None,
                        });
                    }
                }
            }
        }
    }

    result
}

fn read_tasks(repo_path: &str) -> ParsedTasks {
    let tasks_path = PathBuf::from(repo_path).join("TASKS.md");
    match fs::read_to_string(&tasks_path) {
        Ok(content) => parse_tasks_in_file(&content),
        Err(_) => ParsedTasks::default(),
    }
}

#[tauri::command]
pub fn scan_tasks_across_repos(folder_path: String) -> Result<Vec<RepoTaskSummary>, String> {
    let path = PathBuf::from(&folder_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", folder_path));
    }

    // Use scan_all_projects logic to discover repos
    let entries = scan_all_projects(folder_path)?;
    let mut summaries: Vec<RepoTaskSummary> = Vec::new();

    for entry in &entries {
        if entry.is_workspace {
            for child in &entry.children {
                let parsed = read_tasks(&child.path);
                summaries.push(RepoTaskSummary {
                    name: child.name.clone(),
                    path: child.path.clone(),
                    workspace_name: Some(entry.name.clone()),
                    ungroomed_count: parsed.ungroomed_count,
                    groomed_count: parsed.groomed_count,
                    active_count: parsed.active_count,
                    ungroomed_tasks: parsed.ungroomed_tasks,
                    groomed_tasks: parsed.groomed_tasks,
                    active_tasks: parsed.active_tasks,
                });
            }
        } else {
            let parsed = read_tasks(&entry.path);
            summaries.push(RepoTaskSummary {
                name: entry.name.clone(),
                path: entry.path.clone(),
                workspace_name: None,
                ungroomed_count: parsed.ungroomed_count,
                groomed_count: parsed.groomed_count,
                active_count: parsed.active_count,
                ungroomed_tasks: parsed.ungroomed_tasks,
                groomed_tasks: parsed.groomed_tasks,
                active_tasks: parsed.active_tasks,
            });
        }
    }

    Ok(summaries)
}

/// Convert a task description to a kebab-case slug.
fn to_kebab_case(input: &str) -> String {
    let lowered = input.to_lowercase();
    // Single pass: replace non-alphanumeric with '-' and collapse consecutive hyphens
    let mut result = String::with_capacity(lowered.len());
    let mut prev_hyphen = false;
    for c in lowered.chars() {
        if c.is_alphanumeric() {
            result.push(c);
            prev_hyphen = false;
        } else if !prev_hyphen {
            result.push('-');
            prev_hyphen = true;
        }
    }
    // Trim leading/trailing hyphens
    result.trim_matches('-').to_string()
}

/// A single attachment reference attached to an ungroomed task. The `path` is
/// the relative path (from the project root) that was returned by
/// `save_attachment_image`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAttachment {
    pub label: String,
    pub path: String,
}

/// An ungroomed task description plus any image attachments captured for it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWithAttachments {
    pub description: String,
    #[serde(default)]
    pub attachments: Vec<TaskAttachment>,
}

/// Append ungroomed tasks to a project's TASKS.md file.
/// Creates the file with basic structure if it doesn't exist.
/// Creates the `### Ungroomed` section if it doesn't exist.
///
/// When a task has attachments, an indented `> attachments:` annotation line is
/// emitted directly under its `- [ ]` line. The `- [ ]` line format is unchanged
/// from the no-attachments case.
#[tauri::command]
pub fn append_ungroomed_tasks(
    project_path: String,
    tasks: Vec<TaskWithAttachments>,
) -> Result<(), String> {
    if tasks.is_empty() {
        return Ok(());
    }

    let path = PathBuf::from(&project_path);
    let tasks_file = path.join("TASKS.md");

    let content = if tasks_file.exists() {
        fs::read_to_string(&tasks_file)
            .map_err(|e| format!("Failed to read TASKS.md: {}", e))?
    } else {
        // Create with basic structure
        String::from("# Tasks\n\n## Backlog\n\n### Ungroomed\n")
    };

    // Build the new task lines
    let mut new_lines = String::new();
    for task in &tasks {
        let trimmed = task.description.trim();
        if !trimmed.is_empty() {
            let slug = to_kebab_case(trimmed);
            if slug.is_empty() {
                continue; // Skip tasks with no alphanumeric content
            }
            new_lines.push_str(&format!("- [ ] {}: {}\n", slug, trimmed));
            if !task.attachments.is_empty() {
                let parts: Vec<String> = task
                    .attachments
                    .iter()
                    .map(|a| format!("[{}]={}", a.label, a.path))
                    .collect();
                new_lines.push_str(&format!("  > attachments: {}\n", parts.join(", ")));
            }
        }
    }

    if new_lines.is_empty() {
        return Ok(());
    }

    let updated = if let Some(pos) = content.find("### Ungroomed") {
        // Find the end of the "### Ungroomed" heading line
        let after_heading = match content[pos..].find('\n') {
            Some(nl) => pos + nl + 1,
            None => content.len(),
        };

        // Insert new tasks right after the heading line
        let mut result = String::with_capacity(content.len() + new_lines.len());
        result.push_str(&content[..after_heading]);
        result.push_str(&new_lines);
        result.push_str(&content[after_heading..]);
        result
    } else if let Some(pos) = content.find("## Backlog") {
        // Find the end of "## Backlog" heading line
        let after_heading = match content[pos..].find('\n') {
            Some(nl) => pos + nl + 1,
            None => {
                // No newline after ## Backlog, add one
                let mut result = String::with_capacity(content.len() + new_lines.len() + 20);
                result.push_str(&content);
                result.push_str("\n\n### Ungroomed\n");
                result.push_str(&new_lines);
                return fs::write(&tasks_file, result)
                    .map_err(|e| format!("Failed to write TASKS.md: {}", e));
            }
        };

        // Insert ### Ungroomed section after ## Backlog heading
        let mut result = String::with_capacity(content.len() + new_lines.len() + 20);
        result.push_str(&content[..after_heading]);
        result.push_str("\n### Ungroomed\n");
        result.push_str(&new_lines);
        result.push('\n');
        result.push_str(&content[after_heading..]);
        result
    } else {
        // No Backlog section at all — append both
        let mut result = String::with_capacity(content.len() + new_lines.len() + 40);
        result.push_str(&content);
        if !content.ends_with('\n') {
            result.push('\n');
        }
        result.push_str("\n## Backlog\n\n### Ungroomed\n");
        result.push_str(&new_lines);
        result
    };

    fs::write(&tasks_file, updated)
        .map_err(|e| format!("Failed to write TASKS.md: {}", e))
}

/// Allowed image extensions for paste/drop attachments. HEIC/HEIF and other
/// non-Read-tool-friendly formats are rejected at the boundary.
const ALLOWED_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

/// Validate that a task slug contains only safe characters: `[A-Za-z0-9._-]`.
/// Rejects empty strings, `.`, `..`, and any control characters (including `\r`,
/// `\n`). Only applied to colon-style slugs and active-section headers — the
/// no-colon kebab path uses `to_kebab_case` which already excludes control chars
/// by construction, and restricting it would break Unicode task descriptions.
fn is_safe_slug(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// Validate that a directory name is safe to use as a single path component
/// under `.reggie/attachments/`: non-empty, no path separators, no `..`, only
/// `[a-zA-Z0-9_-]` characters.
fn is_safe_attachment_dir_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Idempotently ensure `.reggie/attachments/.gitignore` exists with the
/// self-ignoring content `*\n!.gitignore`. Leaves an existing correct file
/// alone.
fn ensure_attachments_gitignore(attachments_root: &Path) -> Result<(), String> {
    const GITIGNORE_CONTENT: &str = "*\n!.gitignore\n";
    let gitignore = attachments_root.join(".gitignore");
    if gitignore.exists() {
        // Leave any existing file alone. We only auto-write when the file is
        // missing — if a user has customized it, we don't second-guess them.
        return Ok(());
    }
    fs::write(&gitignore, GITIGNORE_CONTENT)
        .map_err(|e| format!("Failed to write .reggie/attachments/.gitignore: {}", e))
}

/// Result returned to the frontend after a successful image save.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAttachmentResult {
    pub label_index: u32,
    pub path: String,
}

/// Save a pasted/dropped image into `.reggie/attachments/{dir_name}/{n}.{ext}`,
/// where `n` = (max existing numeric filename in the dir) + 1.
///
/// The frontend owns `dir_name` (e.g. `fix-foo-a3b4c5`) so that grouping is
/// stable per textarea-session without server-side state. On the first save
/// into the parent `.reggie/attachments/`, a self-ignoring `.gitignore` is
/// created.
#[tauri::command]
pub fn save_attachment_image(
    project_path: String,
    dir_name: String,
    extension: String,
    image_bytes: Vec<u8>,
) -> Result<SaveAttachmentResult, String> {
    let ext_lower = extension.to_lowercase();
    if !ALLOWED_IMAGE_EXTENSIONS.contains(&ext_lower.as_str()) {
        return Err(format!("unsupported image extension: {}", extension));
    }

    if !is_safe_attachment_dir_name(&dir_name) {
        return Err(format!("invalid attachment dir name: {}", dir_name));
    }

    let project = PathBuf::from(&project_path);
    let attachments_root = project.join(".reggie").join("attachments");
    let attachment_dir = attachments_root.join(&dir_name);

    fs::create_dir_all(&attachment_dir)
        .map_err(|e| format!("Failed to create attachment dir: {}", e))?;

    // Now that the parent .reggie/attachments/ exists, ensure the .gitignore.
    ensure_attachments_gitignore(&attachments_root)?;

    // Determine the next index by scanning existing `<n>.<ext>` filenames.
    let mut max_index: u32 = 0;
    let read_dir = fs::read_dir(&attachment_dir)
        .map_err(|e| format!("Failed to read attachment dir: {}", e))?;
    for entry in read_dir.flatten() {
        let file_name = entry.file_name();
        let name = match file_name.to_str() {
            Some(n) => n,
            None => continue,
        };
        // Parse leading digits before the first '.'.
        let stem = match name.split('.').next() {
            Some(s) => s,
            None => continue,
        };
        if let Ok(n) = stem.parse::<u32>() {
            if n > max_index {
                max_index = n;
            }
        }
    }
    let next_index = max_index + 1;

    let file_name = format!("{}.{}", next_index, ext_lower);
    let file_path = attachment_dir.join(&file_name);
    fs::write(&file_path, &image_bytes)
        .map_err(|e| format!("Failed to write attachment file: {}", e))?;

    // Build the relative path with forward slashes, regardless of host OS.
    let relative_path = format!(".reggie/attachments/{}/{}", dir_name, file_name);

    Ok(SaveAttachmentResult {
        label_index: next_index,
        path: relative_path,
    })
}

/// Recursively delete the named attachment dirs under `.reggie/attachments/`.
/// Idempotent: missing dirs are silent no-ops. Returns the number of dirs
/// actually removed.
#[tauri::command]
pub fn cleanup_attachments(
    project_path: String,
    dir_names: Vec<String>,
) -> Result<u32, String> {
    let project = PathBuf::from(&project_path);
    let attachments_root = project.join(".reggie").join("attachments");
    let mut removed: u32 = 0;
    for name in &dir_names {
        if !is_safe_attachment_dir_name(name) {
            return Err(format!("invalid attachment dir name: {}", name));
        }
        let target = attachments_root.join(name);
        if target.exists() {
            fs::remove_dir_all(&target)
                .map_err(|e| format!("Failed to remove attachment dir {}: {}", name, e))?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Scan TASKS.md for `.reggie/attachments/<dir>/` references; collect dir names
/// that appear under the attachments root on disk; return the set difference
/// (i.e. dirs that exist on disk but aren't referenced in TASKS.md).
#[tauri::command]
pub fn list_orphan_attachments(project_path: String) -> Result<Vec<String>, String> {
    let project = PathBuf::from(&project_path);
    let attachments_root = project.join(".reggie").join("attachments");

    if !attachments_root.exists() {
        return Ok(Vec::new());
    }

    // Collect referenced dir names from TASKS.md (if it exists).
    let mut referenced: HashSet<String> = HashSet::new();
    let tasks_file = project.join("TASKS.md");
    if tasks_file.exists() {
        let content = fs::read_to_string(&tasks_file)
            .map_err(|e| format!("Failed to read TASKS.md: {}", e))?;
        extract_attachment_dir_refs(&content, &mut referenced);
    }

    // List subdirs under .reggie/attachments/.
    let mut orphans: Vec<String> = Vec::new();
    let read_dir = fs::read_dir(&attachments_root)
        .map_err(|e| format!("Failed to read .reggie/attachments/: {}", e))?;
    for entry in read_dir.flatten() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }
        let file_name = entry.file_name();
        let name = match file_name.to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !referenced.contains(&name) {
            orphans.push(name);
        }
    }

    orphans.sort();
    Ok(orphans)
}

/// Extract attachment dir names from TASKS.md text.
///
/// Looks for the literal substring `.reggie/attachments/` and captures the
/// following path component up to the next `/`. Stops on whitespace, commas,
/// `]`, or `)` to avoid pulling in trailing markup. We intentionally avoid the
/// `regex` crate to keep the dependency tree minimal — this is a manual scan.
fn extract_attachment_dir_refs(content: &str, out: &mut HashSet<String>) {
    const NEEDLE: &str = ".reggie/attachments/";
    let mut start = 0usize;
    while let Some(idx) = content[start..].find(NEEDLE) {
        let after = start + idx + NEEDLE.len();
        let tail = &content[after..];
        let mut end = 0usize;
        for (i, c) in tail.char_indices() {
            if c == '/' || c.is_whitespace() || c == ',' || c == ']' || c == ')' {
                end = i;
                break;
            }
            end = i + c.len_utf8();
        }
        if end > 0 {
            let name = &tail[..end];
            // Only record if the path component looks like a directory: i.e.
            // the character that terminated us is `/` (so it's
            // `.reggie/attachments/<name>/...`). Otherwise it's a malformed or
            // non-directory reference and we skip it.
            let terminator = tail[end..].chars().next();
            if terminator == Some('/') && is_safe_attachment_dir_name(name) {
                out.insert(name.to_string());
            }
        }
        start = after;
    }
}

/// Validate and canonicalize a path requested for recursive watching.
///
/// Rejects root, the user's home directory, and any ancestor of the user's
/// home directory — recursively watching these would exhaust FSEvents/inotify
/// resources. Both `path` and `home` are canonicalized so symlinked or
/// otherwise-aliased home directories still match. Returns the canonical path
/// on success.
fn validate_watch_path(path: &Path, home: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|e| format!("Path cannot be canonicalized: {}: {}", path.display(), e))?;

    // Canonicalize home for matching, but keep the raw form too — if home is
    // unresolvable (e.g. a stale symlink) we still want to match the literal.
    let canonical_home = fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());

    // Reject filesystem root.
    if canonical.parent().is_none() {
        return Err(format!("Path is too broad to watch: {}", canonical.display()));
    }

    // Reject equality with either form of home.
    if canonical == canonical_home || canonical == home {
        return Err(format!("Path is too broad to watch: {}", canonical.display()));
    }

    // Reject ancestors of canonical home (covers `/`, `/Users`, `/home`).
    if canonical_home.starts_with(&canonical) {
        return Err(format!("Path is too broad to watch: {}", canonical.display()));
    }

    Ok(canonical)
}

/// Start (or restart) the `TASKS.md` filesystem watcher rooted at `path`.
///
/// Replaces any existing watcher. Emits `tasks-md-changed` events on the app
/// handle when any `TASKS.md` under the watched tree is modified. Tolerates
/// missing `TASKS.md` files — events fire only when one is actually touched.
#[tauri::command]
pub async fn start_tasks_md_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    path: String,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    let canonical = validate_watch_path(&path_buf, &home)?;

    // Lock first, drop the old watcher, THEN construct the new one — this
    // avoids any window where two overlapping watchers are alive at once and
    // could double-emit events. If `start()` fails we end up with no watcher,
    // which is acceptable: the frontend has poll/focus fallbacks and a failure
    // here means the path is bad anyway.
    let mut guard = state.tasks_watcher.lock().await;
    *guard = None;

    let new_watcher = crate::watchers::tasks_md::start(app, canonical)
        .map_err(|e| format!("Failed to start TASKS.md watcher: {}", e))?;
    *guard = Some(new_watcher);
    Ok(())
}

/// Stop the `TASKS.md` filesystem watcher, if one is active. No-op otherwise.
#[tauri::command]
pub async fn stop_tasks_md_watch(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let mut guard = state.tasks_watcher.lock().await;
    *guard = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Extract slug names from a ParallelizableTasksResult for easy assertion.
    /// Returns `active_slugs` concatenated with `backlog_slugs`, mirroring the
    /// previous combined `slugs` field so existing assertions stay valid.
    fn slug_names(result: &ParallelizableTasksResult) -> Vec<String> {
        result
            .active_slugs
            .iter()
            .chain(result.backlog_slugs.iter())
            .map(|s| s.slug.clone())
            .collect()
    }

    /// Just the backlog slug names.
    fn backlog_slug_names(result: &ParallelizableTasksResult) -> Vec<String> {
        result.backlog_slugs.iter().map(|s| s.slug.clone()).collect()
    }

    // --- merge_deps ---

    #[test]
    fn merge_deps_combines_deps_and_dev_deps() {
        let pkg: serde_json::Value = serde_json::json!({
            "dependencies": { "react": "^18", "react-dom": "^18" },
            "devDependencies": { "typescript": "^5", "vite": "^5" }
        });
        let deps = merge_deps(&pkg);
        assert!(deps.contains("react"));
        assert!(deps.contains("react-dom"));
        assert!(deps.contains("typescript"));
        assert!(deps.contains("vite"));
        assert_eq!(deps.len(), 4);
    }

    #[test]
    fn merge_deps_handles_missing_sections() {
        let pkg: serde_json::Value = serde_json::json!({ "name": "test" });
        let deps = merge_deps(&pkg);
        assert!(deps.is_empty());
    }

    #[test]
    fn merge_deps_deduplicates() {
        let pkg: serde_json::Value = serde_json::json!({
            "dependencies": { "lodash": "^4" },
            "devDependencies": { "lodash": "^4" }
        });
        let deps = merge_deps(&pkg);
        assert_eq!(deps.len(), 1);
    }

    // --- deps_has ---

    #[test]
    fn deps_has_finds_existing() {
        let mut deps = std::collections::HashSet::new();
        deps.insert("react".to_string());
        assert!(deps_has(&deps, "react"));
        assert!(!deps_has(&deps, "vue"));
    }

    // --- has_extension_in_dir ---

    #[test]
    fn has_extension_in_dir_finds_extension() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::File::create(dir.path().join("project.xcodeproj")).unwrap();
        assert!(has_extension_in_dir(dir.path(), "xcodeproj"));
    }

    #[test]
    fn has_extension_in_dir_no_match() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::File::create(dir.path().join("file.txt")).unwrap();
        assert!(!has_extension_in_dir(dir.path(), "xcodeproj"));
    }

    // --- read_file_truncated ---

    #[test]
    fn read_file_truncated_reads_short_file() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("short.txt");
        std::fs::write(&file_path, "Hello world").unwrap();

        let result = read_file_truncated(&file_path, 100);
        assert_eq!(result, Some("Hello world".to_string()));
    }

    #[test]
    fn read_file_truncated_truncates_long_file() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("long.txt");
        let content = "x".repeat(500);
        std::fs::write(&file_path, &content).unwrap();

        let result = read_file_truncated(&file_path, 100);
        assert!(result.is_some());
        assert_eq!(result.unwrap().len(), 100);
    }

    #[test]
    fn read_file_truncated_multibyte_utf8_no_panic() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("emoji.txt");
        // Each emoji is 4 bytes. 50 emojis = 200 bytes.
        let content = "\u{1F600}".repeat(50);
        std::fs::write(&file_path, &content).unwrap();

        // Truncate at 10 bytes — falls in the middle of a 4-byte emoji
        let result = read_file_truncated(&file_path, 10);
        assert!(result.is_some());
        let text = result.unwrap();
        // Should truncate to a valid char boundary (8 bytes = 2 emojis)
        assert_eq!(text.len(), 8);
        assert!(text.is_char_boundary(text.len()));
    }

    #[test]
    fn read_file_truncated_missing_file() {
        let path = PathBuf::from("/nonexistent/file.txt");
        assert_eq!(read_file_truncated(&path, 100), None);
    }

    #[test]
    fn read_file_truncated_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("empty.txt");
        std::fs::write(&file_path, "").unwrap();
        assert_eq!(read_file_truncated(&file_path, 100), None);
    }

    // --- read_readme_excerpt ---

    #[test]
    fn read_readme_excerpt_extracts_paragraph_after_title() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("README.md"),
            "# My Project\n\nThis is the description of the project.\n\n## Getting Started\n",
        ).unwrap();

        let result = read_readme_excerpt(dir.path());
        assert!(result.is_some());
        assert_eq!(result.unwrap(), "This is the description of the project.");
    }

    #[test]
    fn read_readme_excerpt_skips_badges() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("README.md"),
            "# My Project\n\n[![Build](https://badge.svg)](https://link)\n![Logo](logo.png)\n\nActual description here.\n",
        ).unwrap();

        let result = read_readme_excerpt(dir.path());
        assert!(result.is_some());
        assert_eq!(result.unwrap(), "Actual description here.");
    }

    #[test]
    fn read_readme_excerpt_no_readme() {
        let dir = tempfile::tempdir().unwrap();
        let result = read_readme_excerpt(dir.path());
        assert!(result.is_none());
    }

    // --- scan_workspace ---

    #[test]
    fn scan_workspace_lists_directories() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("project-a")).unwrap();
        std::fs::create_dir(dir.path().join("project-b")).unwrap();
        std::fs::write(dir.path().join("file.txt"), "not a dir").unwrap();
        std::fs::create_dir(dir.path().join(".hidden")).unwrap();

        let result = scan_workspace(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());
        let entries = result.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "project-a");
        assert_eq!(entries[1].name, "project-b");
    }

    #[test]
    fn scan_workspace_detects_git_and_claude_md() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("myproject");
        std::fs::create_dir(&proj).unwrap();
        std::fs::create_dir(proj.join(".git")).unwrap();
        std::fs::write(proj.join("CLAUDE.md"), "# Instructions").unwrap();

        let result = scan_workspace(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_git_repo);
        assert!(result[0].has_claude_md);
    }

    // --- scan_all_projects ---

    #[test]
    fn scan_all_projects_detects_standalone_repos() {
        let dir = tempfile::tempdir().unwrap();
        // Create a standalone repo (has .git)
        let repo = dir.path().join("my-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "my-repo");
        assert!(!result[0].is_workspace);
        assert!(result[0].is_git_repo);
        assert!(result[0].children.is_empty());
    }

    #[test]
    fn scan_all_projects_detects_workspaces() {
        let dir = tempfile::tempdir().unwrap();
        // Create a workspace (no .git, but contains repos)
        let ws = dir.path().join("my-workspace");
        std::fs::create_dir(&ws).unwrap();
        let repo_a = ws.join("repo-a");
        std::fs::create_dir(&repo_a).unwrap();
        std::fs::create_dir(repo_a.join(".git")).unwrap();
        let repo_b = ws.join("repo-b");
        std::fs::create_dir(&repo_b).unwrap();
        std::fs::create_dir(repo_b.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "my-workspace");
        assert!(result[0].is_workspace);
        assert!(!result[0].is_git_repo);
        assert_eq!(result[0].children.len(), 2);
        assert_eq!(result[0].children[0].name, "repo-a");
        assert_eq!(result[0].children[1].name, "repo-b");
    }

    #[test]
    fn scan_all_projects_mixed_repos_and_workspaces() {
        let dir = tempfile::tempdir().unwrap();

        // Standalone repo
        let standalone = dir.path().join("standalone");
        std::fs::create_dir(&standalone).unwrap();
        std::fs::create_dir(standalone.join(".git")).unwrap();

        // Workspace with one repo
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();
        let child = ws.join("child-repo");
        std::fs::create_dir(&child).unwrap();
        std::fs::create_dir(child.join(".git")).unwrap();

        // Empty dir (should be skipped — no .git and no git children)
        let empty = dir.path().join("empty-dir");
        std::fs::create_dir(&empty).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        // Should only have standalone + workspace (empty dir skipped)
        assert_eq!(result.len(), 2);

        let standalone_entry = result.iter().find(|e| e.name == "standalone").unwrap();
        assert!(!standalone_entry.is_workspace);
        assert!(standalone_entry.is_git_repo);

        let ws_entry = result.iter().find(|e| e.name == "workspace").unwrap();
        assert!(ws_entry.is_workspace);
        assert_eq!(ws_entry.children.len(), 1);
    }

    #[test]
    fn scan_all_projects_skips_hidden_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let hidden = dir.path().join(".hidden-repo");
        std::fs::create_dir(&hidden).unwrap();
        std::fs::create_dir(hidden.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn scan_all_projects_invalid_path() {
        let result = scan_all_projects("/nonexistent/path/abc123".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn scan_all_projects_skips_hidden_children_in_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("my-workspace");
        std::fs::create_dir(&ws).unwrap();
        // Visible repo
        let repo = ws.join("visible-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();
        // Hidden repo — should be skipped
        let hidden = ws.join(".hidden-repo");
        std::fs::create_dir(&hidden).unwrap();
        std::fs::create_dir(hidden.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_workspace);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "visible-repo");
    }

    #[test]
    fn scan_all_projects_skips_dir_with_only_non_git_subdirs() {
        let dir = tempfile::tempdir().unwrap();
        // A directory with subdirs that have no .git — not a workspace, not a repo
        let non_ws = dir.path().join("docs-folder");
        std::fs::create_dir(&non_ws).unwrap();
        std::fs::create_dir(non_ws.join("chapter1")).unwrap();
        std::fs::create_dir(non_ws.join("chapter2")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn scan_all_projects_detects_claude_md_on_standalone_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("my-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();
        std::fs::write(repo.join("CLAUDE.md"), "# Instructions").unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].has_claude_md);
    }

    #[test]
    fn scan_all_projects_detects_claude_md_on_workspace_children() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();
        let repo = ws.join("repo-with-claude");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();
        std::fs::write(repo.join("CLAUDE.md"), "# Hello").unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_workspace);
        assert_eq!(result[0].children.len(), 1);
        assert!(result[0].children[0].has_claude_md);
    }

    #[test]
    fn scan_all_projects_ignores_files_at_top_level() {
        let dir = tempfile::tempdir().unwrap();
        // Files at the top level should not appear in results
        std::fs::write(dir.path().join("notes.txt"), "hello").unwrap();
        std::fs::write(dir.path().join(".gitconfig"), "config").unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn scan_all_projects_sorts_results_alphabetically() {
        let dir = tempfile::tempdir().unwrap();
        // Create repos in non-alphabetical order
        for name in &["zebra-repo", "alpha-repo", "Mango-repo"] {
            let repo = dir.path().join(name);
            std::fs::create_dir(&repo).unwrap();
            std::fs::create_dir(repo.join(".git")).unwrap();
        }

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].name, "alpha-repo");
        // Case-insensitive sort: "Mango" before "zebra"
        assert_eq!(result[1].name, "Mango-repo");
        assert_eq!(result[2].name, "zebra-repo");
    }

    #[test]
    fn scan_all_projects_workspace_children_sorted_alphabetically() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("my-workspace");
        std::fs::create_dir(&ws).unwrap();
        for name in &["zeta", "Alpha", "beta"] {
            let repo = ws.join(name);
            std::fs::create_dir(&repo).unwrap();
            std::fs::create_dir(repo.join(".git")).unwrap();
        }

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result[0].children.len(), 3);
        assert_eq!(result[0].children[0].name, "Alpha");
        assert_eq!(result[0].children[1].name, "beta");
        assert_eq!(result[0].children[2].name, "zeta");
    }

    #[test]
    fn scan_all_projects_empty_directory() {
        let dir = tempfile::tempdir().unwrap();
        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn scan_all_projects_workspace_ignores_files_inside() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("my-workspace");
        std::fs::create_dir(&ws).unwrap();
        // One real repo
        let repo = ws.join("real-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();
        // A file that should be ignored
        std::fs::write(ws.join("README.md"), "workspace readme").unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "real-repo");
    }

    // --- Recursive scan: deep nesting ---

    #[test]
    fn scan_all_projects_finds_repos_three_levels_deep() {
        let dir = tempfile::tempdir().unwrap();
        // Desktop -> Projects -> Workspace -> repo
        let workspace = dir.path().join("Projects").join("Workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let repo = workspace.join("deep-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Projects");
        assert!(result[0].is_workspace);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "deep-repo");
    }

    #[test]
    fn scan_all_projects_finds_repos_four_levels_deep() {
        let dir = tempfile::tempdir().unwrap();
        // org -> team -> category -> project
        let category = dir.path().join("org").join("team").join("category");
        std::fs::create_dir_all(&category).unwrap();
        let repo = category.join("my-project");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "org");
        assert!(result[0].is_workspace);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "my-project");
    }

    #[test]
    fn scan_all_projects_finds_repos_five_levels_deep() {
        let dir = tempfile::tempdir().unwrap();
        let deep = dir.path().join("a").join("b").join("c").join("d");
        std::fs::create_dir_all(&deep).unwrap();
        let repo = deep.join("deep-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "a");
        assert!(result[0].is_workspace);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "deep-repo");
    }

    // --- Recursive scan: skip directories ---

    #[test]
    fn scan_all_projects_skips_node_modules_containing_git() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("my-workspace");
        std::fs::create_dir(&ws).unwrap();
        // Real repo
        let repo = ws.join("real-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();
        // node_modules with a .git inside (should be skipped)
        let nm = ws.join("node_modules");
        std::fs::create_dir(&nm).unwrap();
        let fake_repo = nm.join("some-package");
        std::fs::create_dir(&fake_repo).unwrap();
        std::fs::create_dir(fake_repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "real-repo");
    }

    #[test]
    fn scan_all_projects_skips_all_skip_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();

        // Create a real repo so the workspace is not empty
        let real = ws.join("real");
        std::fs::create_dir(&real).unwrap();
        std::fs::create_dir(real.join(".git")).unwrap();

        // Create each skip dir with a fake .git inside
        for skip_name in &["node_modules", "target", "build", "dist", "vendor", "__pycache__", ".next", ".nuxt", ".venv", "venv"] {
            let skip = ws.join(skip_name);
            std::fs::create_dir(&skip).unwrap();
            let fake = skip.join("nested");
            std::fs::create_dir(&fake).unwrap();
            std::fs::create_dir(fake.join(".git")).unwrap();
        }

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "real");
    }

    #[test]
    fn scan_all_projects_skips_node_modules_at_various_depths() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();

        // Real repo
        let repo = ws.join("my-app");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        // node_modules at depth 1 inside workspace
        let nm1 = ws.join("node_modules");
        std::fs::create_dir(&nm1).unwrap();
        std::fs::create_dir(nm1.join(".git")).unwrap();

        // node_modules at depth 2 (inside a non-git subdir)
        let subdir = ws.join("packages");
        std::fs::create_dir(&subdir).unwrap();
        let nm2 = subdir.join("node_modules");
        std::fs::create_dir(&nm2).unwrap();
        let fake2 = nm2.join("dep");
        std::fs::create_dir(&fake2).unwrap();
        std::fs::create_dir(fake2.join(".git")).unwrap();

        // Real repo inside packages
        let pkg_repo = subdir.join("pkg-a");
        std::fs::create_dir(&pkg_repo).unwrap();
        std::fs::create_dir(pkg_repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        let children = &result[0].children;
        assert_eq!(children.len(), 2);
        let names: Vec<&str> = children.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"my-app"));
        assert!(names.contains(&"pkg-a"));
    }

    // --- Recursive scan: hidden dirs at all levels ---

    #[test]
    fn scan_all_projects_skips_hidden_dirs_at_intermediate_levels() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();

        // Hidden intermediate dir containing a repo -- should be skipped
        let hidden_mid = ws.join(".hidden-folder");
        std::fs::create_dir(&hidden_mid).unwrap();
        let hidden_repo = hidden_mid.join("secret-repo");
        std::fs::create_dir(&hidden_repo).unwrap();
        std::fs::create_dir(hidden_repo.join(".git")).unwrap();

        // Visible repo for comparison
        let visible = ws.join("visible-repo");
        std::fs::create_dir(&visible).unwrap();
        std::fs::create_dir(visible.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "visible-repo");
    }

    // --- Recursive scan: symlinks ---

    #[cfg(unix)]
    #[test]
    fn scan_all_projects_does_not_follow_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();

        // Real repo
        let repo = ws.join("real-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        // Symlink to the real repo (should be skipped)
        std::os::unix::fs::symlink(&repo, ws.join("linked-repo")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "real-repo");
    }

    #[cfg(unix)]
    #[test]
    fn scan_all_projects_skips_symlinked_intermediate_dir() {
        // Use a separate tempdir for the external target so it is outside the scan root
        let external_dir = tempfile::tempdir().unwrap();
        let ext_repo = external_dir.path().join("ext-repo");
        std::fs::create_dir(&ext_repo).unwrap();
        std::fs::create_dir(ext_repo.join(".git")).unwrap();

        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();

        // Symlink intermediate dir inside workspace pointing outside the scan root
        std::os::unix::fs::symlink(external_dir.path(), ws.join("link-to-external")).unwrap();

        // Real repo for baseline
        let real = ws.join("real");
        std::fs::create_dir(&real).unwrap();
        std::fs::create_dir(real.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "real");
    }

    // --- Recursive scan: mixed depths ---

    #[test]
    fn scan_all_projects_finds_repos_at_mixed_depths() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();

        // Repo at depth 1 (direct child of workspace)
        let shallow = ws.join("shallow-repo");
        std::fs::create_dir(&shallow).unwrap();
        std::fs::create_dir(shallow.join(".git")).unwrap();

        // Repo at depth 3 (workspace -> category -> subcategory -> repo)
        let deep_parent = ws.join("category").join("subcategory");
        std::fs::create_dir_all(&deep_parent).unwrap();
        let deep = deep_parent.join("deep-repo");
        std::fs::create_dir(&deep).unwrap();
        std::fs::create_dir(deep.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_workspace);
        let children = &result[0].children;
        assert_eq!(children.len(), 2);
        let names: Vec<&str> = children.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"shallow-repo"));
        assert!(names.contains(&"deep-repo"));
    }

    // --- Recursive scan: git boundary ---

    #[test]
    fn scan_all_projects_stops_recursing_at_git_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();

        // Parent repo
        let parent_repo = ws.join("parent-repo");
        std::fs::create_dir(&parent_repo).unwrap();
        std::fs::create_dir(parent_repo.join(".git")).unwrap();

        // Nested repo inside the parent (e.g., a submodule or vendored dep)
        let nested = parent_repo.join("vendor").join("nested-repo");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir(nested.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].name, "parent-repo");
        // nested-repo should NOT appear because recursion stops at parent-repo's .git
    }

    // --- Recursive scan: empty intermediate dirs ---

    #[test]
    fn scan_all_projects_skips_empty_intermediate_dirs() {
        let dir = tempfile::tempdir().unwrap();
        // Non-git dir with nested empty dirs but no repos anywhere
        let empty_tree = dir.path().join("empty-tree");
        std::fs::create_dir_all(empty_tree.join("a").join("b").join("c")).unwrap();

        // Also a real workspace for contrast
        let ws = dir.path().join("real-ws");
        std::fs::create_dir(&ws).unwrap();
        let repo = ws.join("repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        // empty-tree should be excluded entirely
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "real-ws");
    }

    // --- find_git_repos unit tests ---

    #[test]
    fn find_git_repos_returns_empty_for_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let repos = find_git_repos(dir.path());
        assert!(repos.is_empty());
    }

    #[test]
    fn find_git_repos_finds_direct_child_repos() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo-a");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].name, "repo-a");
        assert!(repos[0].is_git_repo);
    }

    #[test]
    fn find_git_repos_recurses_through_non_git_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        let repo = nested.join("deep");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].name, "deep");
    }

    #[test]
    fn find_git_repos_does_not_recurse_into_git_repos() {
        let dir = tempfile::tempdir().unwrap();
        let outer = dir.path().join("outer");
        std::fs::create_dir(&outer).unwrap();
        std::fs::create_dir(outer.join(".git")).unwrap();
        // Inner repo should not be found
        let inner = outer.join("sub").join("inner");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::create_dir(inner.join(".git")).unwrap();

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].name, "outer");
    }

    #[test]
    fn find_git_repos_sorts_results_case_insensitively() {
        let dir = tempfile::tempdir().unwrap();
        for name in &["Zebra", "alpha", "Beta"] {
            let repo = dir.path().join(name);
            std::fs::create_dir(&repo).unwrap();
            std::fs::create_dir(repo.join(".git")).unwrap();
        }

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 3);
        assert_eq!(repos[0].name, "alpha");
        assert_eq!(repos[1].name, "Beta");
        assert_eq!(repos[2].name, "Zebra");
    }

    #[test]
    fn find_git_repos_detects_claude_md() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();
        std::fs::write(repo.join("CLAUDE.md"), "instructions").unwrap();

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 1);
        assert!(repos[0].has_claude_md);
    }

    #[test]
    fn find_git_repos_skips_hidden_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let hidden = dir.path().join(".config");
        std::fs::create_dir(&hidden).unwrap();
        let repo = hidden.join("hidden-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let repos = find_git_repos(dir.path());
        assert!(repos.is_empty());
    }

    #[test]
    fn find_git_repos_skips_skip_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let nm = dir.path().join("node_modules");
        std::fs::create_dir(&nm).unwrap();
        let repo = nm.join("package-with-git");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let repos = find_git_repos(dir.path());
        assert!(repos.is_empty());
    }

    #[test]
    fn scan_workspace_errors_on_invalid_path() {
        let result = scan_workspace("/nonexistent/path/xyz".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a directory"));
    }

    #[test]
    fn scan_workspace_empty_directory() {
        let dir = tempfile::tempdir().unwrap();
        let result = scan_workspace(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(result.is_empty());
    }

    // --- Path correctness ---

    #[test]
    fn find_git_repos_returns_correct_absolute_paths() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("org").join("team");
        std::fs::create_dir_all(&nested).unwrap();
        let repo = nested.join("my-project");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].path, repo.to_string_lossy().to_string());
    }

    #[test]
    fn scan_all_projects_standalone_repo_has_correct_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("my-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].path, repo.to_string_lossy().to_string());
    }

    #[test]
    fn scan_all_projects_deep_child_has_correct_path() {
        let dir = tempfile::tempdir().unwrap();
        let deep_parent = dir.path().join("ws").join("category");
        std::fs::create_dir_all(&deep_parent).unwrap();
        let repo = deep_parent.join("deep-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].children.len(), 1);
        assert_eq!(result[0].children[0].path, repo.to_string_lossy().to_string());
    }

    // --- Workspace-level has_claude_md ---

    #[test]
    fn scan_all_projects_detects_claude_md_on_workspace_dir() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("my-workspace");
        std::fs::create_dir(&ws).unwrap();
        // CLAUDE.md on the workspace dir itself
        std::fs::write(ws.join("CLAUDE.md"), "# Workspace instructions").unwrap();
        let repo = ws.join("child-repo");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_workspace);
        assert!(result[0].has_claude_md);
    }

    // --- .git as file (worktree) ---

    #[test]
    fn find_git_repos_detects_git_file_worktree() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("worktree-repo");
        std::fs::create_dir(&repo).unwrap();
        // Git worktrees create a .git FILE, not a directory
        std::fs::write(repo.join(".git"), "gitdir: /some/other/path/.git/worktrees/wt").unwrap();

        let repos = find_git_repos(dir.path());
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].name, "worktree-repo");
        assert!(repos[0].is_git_repo);
    }

    // --- Error message content ---

    #[test]
    fn scan_all_projects_invalid_path_error_message() {
        let result = scan_all_projects("/nonexistent/path/abc123".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a directory"));
    }

    // --- Multiple repos at different depths in same workspace ---

    // --- parse_task_line ---

    #[test]
    fn parse_task_line_unchecked_task() {
        let result = parse_task_line("- [ ] my-slug: My description [P1] [planned]");
        assert_eq!(result, Some(TaskEntry {
            slug: "my-slug".to_string(),
            description: "My description".to_string(),
            priority: 1,
            depends: vec![],
            conflicts: vec![],
            planned: true,
            checked: false,
            tier: None,
            mode: None,
        }));
    }

    #[test]
    fn parse_task_line_checked_lowercase_x() {
        let result = parse_task_line("- [x] done: Done task [P2] [planned]");
        assert!(result.is_some());
        let task = result.unwrap();
        assert!(task.checked);
        assert_eq!(task.slug, "done");
    }

    #[test]
    fn parse_task_line_checked_uppercase_x() {
        let result = parse_task_line("- [X] done: Done task [P2] [planned]");
        assert!(result.is_some());
        assert!(result.unwrap().checked);
    }

    #[test]
    fn parse_task_line_default_priority_is_p2() {
        let result = parse_task_line("- [ ] slug: Description [planned]");
        assert!(result.is_some());
        assert_eq!(result.unwrap().priority, 2);
    }

    #[test]
    fn parse_task_line_priority_p1() {
        let result = parse_task_line("- [ ] slug: Desc [P1] [planned]");
        assert_eq!(result.unwrap().priority, 1);
    }

    #[test]
    fn parse_task_line_priority_p2() {
        let result = parse_task_line("- [ ] slug: Desc [P2] [planned]");
        assert_eq!(result.unwrap().priority, 2);
    }

    #[test]
    fn parse_task_line_priority_p3() {
        let result = parse_task_line("- [ ] slug: Desc [P3] [planned]");
        assert_eq!(result.unwrap().priority, 3);
    }

    #[test]
    fn parse_task_line_depends_parsing() {
        let result = parse_task_line("- [ ] blocked: Needs deps [P2] [depends: slug-a, slug-b] [planned]");
        let task = result.unwrap();
        assert_eq!(task.depends, vec!["slug-a".to_string(), "slug-b".to_string()]);
    }

    #[test]
    fn parse_task_line_conflicts_parsing() {
        let result = parse_task_line("- [ ] task: Desc [P2] [conflicts: slug-x] [planned]");
        let task = result.unwrap();
        assert_eq!(task.conflicts, vec!["slug-x".to_string()]);
    }

    #[test]
    fn parse_task_line_planned_tag() {
        let task_planned = parse_task_line("- [ ] slug: Desc [planned]").unwrap();
        assert!(task_planned.planned);

        let task_not_planned = parse_task_line("- [ ] slug: Desc [P1]").unwrap();
        assert!(!task_not_planned.planned);
    }

    #[test]
    fn parse_task_line_non_task_line_returns_none() {
        assert!(parse_task_line("### Section Header").is_none());
        assert!(parse_task_line("## Backlog").is_none());
        assert!(parse_task_line("Some random text").is_none());
        assert!(parse_task_line("").is_none());
    }

    #[test]
    fn parse_task_line_no_colon_generates_slug() {
        let task = parse_task_line("- [ ] no-colon-here").unwrap();
        assert_eq!(task.slug, "no-colon-here");
        assert_eq!(task.description, "no-colon-here");
        assert!(!task.checked);
        assert!(!task.planned);
    }

    #[test]
    fn parse_task_line_no_colon_with_spaces() {
        let task = parse_task_line("- [ ] the attempts counter is disappearing on the win modal").unwrap();
        assert_eq!(task.slug, "the-attempts-counter-is-disappearing-on-the-win-modal");
        assert_eq!(task.description, "the attempts counter is disappearing on the win modal");
    }

    #[test]
    fn parse_task_line_no_colon_with_tags() {
        let task = parse_task_line("- [ ] fix something important [P1]").unwrap();
        assert_eq!(task.slug, "fix-something-important");
        assert_eq!(task.description, "fix something important");
        assert_eq!(task.priority, 1);
    }

    #[test]
    fn parse_task_line_no_colon_checked() {
        let task = parse_task_line("- [x] completed task without colon").unwrap();
        assert!(task.checked);
        assert_eq!(task.slug, "completed-task-without-colon");
    }

    #[test]
    fn parse_task_line_empty_slug_returns_none() {
        assert!(parse_task_line("- [ ] : description text [planned]").is_none());
    }

    #[test]
    fn parse_task_line_no_tags() {
        let result = parse_task_line("- [ ] simple: Just a description");
        let task = result.unwrap();
        assert_eq!(task.slug, "simple");
        assert_eq!(task.description, "Just a description");
        assert_eq!(task.priority, 2);
        assert!(task.depends.is_empty());
        assert!(task.conflicts.is_empty());
        assert!(!task.planned);
        assert!(!task.checked);
    }

    #[test]
    fn parse_task_line_depends_with_space_after_colon() {
        let result = parse_task_line("- [ ] task: Desc [depends: slug-a] [planned]");
        let task = result.unwrap();
        assert_eq!(task.depends, vec!["slug-a".to_string()]);
    }

    // --- is_safe_slug ---

    #[test]
    fn is_safe_slug_accepts_valid_slugs() {
        assert!(is_safe_slug("prepare-v2.0.0-release"));
        assert!(is_safe_slug("add-jwt-auth"));
        assert!(is_safe_slug("slug_with_under"));
        assert!(is_safe_slug("a"));
    }

    #[test]
    fn is_safe_slug_rejects_invalid_slugs() {
        assert!(!is_safe_slug(""));
        assert!(!is_safe_slug(".."));
        assert!(!is_safe_slug("bad\rslug"));
        assert!(!is_safe_slug("bad\nslug"));
        assert!(!is_safe_slug("bad\tslug"));
        assert!(!is_safe_slug("bad;slug"));
        assert!(!is_safe_slug("bad/slug"));
        assert!(!is_safe_slug("bad slug"));
        assert!(!is_safe_slug("badé"));
    }

    #[test]
    fn is_safe_slug_dot_edge_cases() {
        // Single `.` is in the whitelist `[A-Za-z0-9._-]` and the function only
        // special-cases empty / `.` / `..`. Pin that `.` is rejected (special-cased
        // alongside `..`) and that strings consisting purely of allowed punctuation
        // like `_` or `-` pass.
        assert!(!is_safe_slug("."));
        assert!(!is_safe_slug(".."));
        assert!(is_safe_slug("_"));
        assert!(is_safe_slug("-"));
        assert!(is_safe_slug("..."));
        assert!(is_safe_slug("v1.2.3"));
    }

    #[test]
    fn parse_task_line_rejects_cr_in_colon_slug() {
        assert!(parse_task_line("- [ ] bad\rslug: description").is_none());
    }

    #[test]
    fn parse_task_line_accepts_clean_colon_slug() {
        let task = parse_task_line("- [ ] good-slug: description [planned]").unwrap();
        assert_eq!(task.slug, "good-slug");
    }

    #[test]
    fn active_section_parser_drops_multiword_header() {
        // A free-form header like "### slug with spaces" parses into a slug
        // containing spaces, which `is_safe_slug` must reject so we don't
        // launch a session against an attacker-controlled descriptive heading.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### slug with spaces\n\
             ### good-slug\n\n\
             ## Backlog\n",
        );
        let result =
            get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        let active: Vec<String> = result.active_slugs.iter().map(|s| s.slug.clone()).collect();
        assert_eq!(active, vec!["good-slug"]);
    }

    #[test]
    fn active_section_parser_drops_dot_dot_header() {
        // A header of `### ..` would, without the is_safe_slug guard, allow
        // an attacker to traverse out of the worktree root.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### ..\n\
             ### good-slug\n\n\
             ## Backlog\n",
        );
        let result =
            get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        let active: Vec<String> = result.active_slugs.iter().map(|s| s.slug.clone()).collect();
        assert_eq!(active, vec!["good-slug"]);
    }

    #[test]
    fn active_section_parser_drops_unsafe_slug_keeps_safe() {
        // Active-section parser reads `### slug` lines under `## Active Tasks`.
        // A header containing an embedded `\r` must be silently dropped while
        // a clean header on the same page survives.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### bad\rslug\n\
             ### good-slug\n\n\
             ## Backlog\n",
        );
        let result =
            get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        let active: Vec<String> = result.active_slugs.iter().map(|s| s.slug.clone()).collect();
        assert_eq!(active, vec!["good-slug"]);
    }

    // --- get_parallelizable_tasks ---

    /// Helper: create a temp dir with a TASKS.md file containing the given content.
    fn create_tasks_md(content: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("TASKS.md"), content).unwrap();
        dir
    }

    #[test]
    fn get_parallelizable_tasks_missing_tasks_md_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read TASKS.md"));
    }

    #[test]
    fn get_parallelizable_tasks_empty_backlog() {
        let dir = create_tasks_md("# TASKS\n\n## Backlog\n\n## Done\n");
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(result.active_slugs.is_empty());
        assert!(result.backlog_slugs.is_empty());
        assert_eq!(result.total_groomed, 0);
    }

    #[test]
    fn get_parallelizable_tasks_single_planned_task() {
        let dir = create_tasks_md(
            "## Backlog\n- [ ] my-task: Do something [P1] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["my-task"]);
        assert_eq!(result.total_groomed, 1);
    }

    #[test]
    fn get_parallelizable_tasks_filters_non_planned() {
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] planned-task: Yes [P1] [planned]\n\
             - [ ] unplanned-task: No [P1]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["planned-task"]);
        assert_eq!(result.total_groomed, 1);
    }

    #[test]
    fn get_parallelizable_tasks_filters_checked() {
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] open: Open task [P1] [planned]\n\
             - [x] done: Done task [P1] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["open"]);
        assert_eq!(result.total_groomed, 1);
    }

    #[test]
    fn get_parallelizable_tasks_only_from_backlog_section() {
        let dir = create_tasks_md(
            "## Active Tasks\n\
             - [ ] active: Active task [P1] [planned]\n\n\
             ## Backlog\n\
             - [ ] backlog: Backlog task [P1] [planned]\n\n\
             ## Done\n\
             - [x] finished: Done [P1] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["backlog"]);
    }

    #[test]
    fn get_parallelizable_tasks_unmet_dependency_excluded() {
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] independent: No deps [P1] [planned]\n\
             - [ ] blocked: Needs prereq [P1] [depends: prereq] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["independent"]);
        assert_eq!(result.total_groomed, 2);
    }

    #[test]
    fn get_parallelizable_tasks_met_dependency_included() {
        let dir = create_tasks_md(
            "## Active Tasks\n\
             - [x] prereq: Already done [P1] [planned]\n\n\
             ## Backlog\n\
             - [ ] dependent: Needs prereq [P1] [depends: prereq] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["dependent"]);
    }

    #[test]
    fn get_parallelizable_tasks_history_md_dependency_resolves() {
        // Dep slug lives only in HISTORY.md (post-migration source of truth).
        // Without reading HISTORY.md, the dep would silently block.
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] dependent: Needs hist-slug [P1] [depends: hist-slug] [planned]\n",
        );
        std::fs::write(
            dir.path().join("HISTORY.md"),
            "# Completed Tasks\n\n- [x] hist-slug Some completed work -- 2026-04-15\n",
        )
        .unwrap();
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["dependent"]);
    }

    #[test]
    fn get_parallelizable_tasks_dependency_in_neither_file_blocked() {
        // Sanity check: with HISTORY.md present but missing the dep, the task
        // remains correctly blocked.
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] dependent: Needs ghost-slug [P1] [depends: ghost-slug] [planned]\n\
             - [ ] independent: No deps [P1] [planned]\n",
        );
        std::fs::write(
            dir.path().join("HISTORY.md"),
            "# Completed Tasks\n\n- [x] other-slug Unrelated -- 2026-04-15\n",
        )
        .unwrap();
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["independent"]);
        assert_eq!(result.total_groomed, 2);
    }

    #[test]
    fn get_parallelizable_tasks_history_md_missing_does_not_error() {
        // No HISTORY.md present — helper returns empty set, dep resolution
        // falls back to TASKS.md `[x]` lines only.
        let dir = create_tasks_md(
            "## Backlog\n\
             - [x] in-tasks: Stale done row [P1] [planned]\n\
             - [ ] dependent: Needs in-tasks [P1] [depends: in-tasks] [planned]\n",
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["dependent"]);
    }

    #[test]
    fn get_parallelizable_tasks_mixed_dependency_sources_resolve() {
        // One dep in TASKS.md `[x]`, another in HISTORY.md — both must resolve.
        let dir = create_tasks_md(
            "## Backlog\n\
             - [x] tasks-prereq: Stale [P1] [planned]\n\
             - [ ] dependent: Needs both [P1] [depends: tasks-prereq, hist-prereq] [planned]\n",
        );
        std::fs::write(
            dir.path().join("HISTORY.md"),
            "# Completed Tasks\n\n- [x] hist-prereq Migrated work -- 2026-04-20\n",
        )
        .unwrap();
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["dependent"]);
    }

    #[test]
    fn read_history_md_slugs_parses_no_colon_format() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("HISTORY.md"),
            "# Completed Tasks\n\n\
             - [x] slug-one Some description -- 2026-04-01\n\
             - [X] slug-two Capital X also accepted -- 2026-04-02\n\
             - [x] slug-three: Tolerates trailing colon -- 2026-04-03\n\
             - [ ] not-checked-skipped Should be ignored\n\
             random line that is not a task\n",
        )
        .unwrap();
        let slugs = read_history_md_slugs(dir.path());
        assert!(slugs.contains("slug-one"));
        assert!(slugs.contains("slug-two"));
        assert!(slugs.contains("slug-three"));
        assert!(!slugs.contains("not-checked-skipped"));
        assert_eq!(slugs.len(), 3);
    }

    #[test]
    fn read_history_md_slugs_missing_file_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let slugs = read_history_md_slugs(dir.path());
        assert!(slugs.is_empty());
    }

    #[test]
    fn get_parallelizable_tasks_conflict_selects_higher_priority() {
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] high: High priority [P1] [conflicts: low] [planned]\n\
             - [ ] low: Low priority [P2] [conflicts: high] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["high"]);
    }

    #[test]
    fn get_parallelizable_tasks_priority_ordering() {
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] p3-task: Low [P3] [planned]\n\
             - [ ] p1-task: High [P1] [planned]\n\
             - [ ] p2-task: Medium [P2] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["p1-task", "p2-task", "p3-task"]);
    }

    #[test]
    fn get_parallelizable_tasks_no_backend_cap() {
        // Backend no longer caps — frontend applies per-domain caps after partitioning.
        let mut content = String::from("## Backlog\n");
        for i in 0..8 {
            content.push_str(&format!("- [ ] task-{}: Task {} [P1] [planned]\n", i, i));
        }
        let dir = create_tasks_md(&content);
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.backlog_slugs.len(), 8);
        assert_eq!(result.total_groomed, 8);
    }

    #[test]
    fn get_parallelizable_tasks_subsection_headers_dont_end_backlog() {
        let dir = create_tasks_md(
            "## Backlog\n\
             ### High Priority\n\
             - [ ] high: Important [P1] [planned]\n\
             ### Low Priority\n\
             - [ ] low: Less important [P3] [planned]\n\n\
             ## Done\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.backlog_slugs.len(), 2);
        assert_eq!(result.backlog_slugs[0].slug, "high");
        assert_eq!(result.backlog_slugs[1].slug, "low");
    }

    #[test]
    fn get_parallelizable_tasks_bidirectional_conflicts() {
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] alpha: First [P1] [conflicts: beta] [planned]\n\
             - [ ] beta: Second [P1] [conflicts: alpha] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        // Only one should be selected; alpha appears first in the list at same priority
        assert_eq!(result.backlog_slugs.len(), 1);
        assert_eq!(result.backlog_slugs[0].slug, "alpha");
    }

    #[test]
    fn get_parallelizable_tasks_complex_scenario() {
        let dir = create_tasks_md(
            "## Active Tasks\n\
             - [x] foundation: Done [P1] [planned]\n\n\
             ## Backlog\n\
             - [ ] ui-work: Frontend [P1] [planned]\n\
             - [ ] api-work: Backend [P1] [conflicts: db-migration] [planned]\n\
             - [ ] db-migration: Migration [P2] [conflicts: api-work] [planned]\n\
             - [ ] docs: Documentation [P3] [planned]\n\
             - [ ] blocked-task: Needs missing [P1] [depends: not-done] [planned]\n\
             - [ ] ready-dep: Has met dep [P2] [depends: foundation] [planned]\n\
             - [ ] unplanned: Not groomed [P1]\n\
             - [x] checked-backlog: Already done [P1] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();

        // total_groomed: planned + unchecked = ui-work, api-work, db-migration, docs, blocked-task, ready-dep = 6
        assert_eq!(result.total_groomed, 6);

        // blocked-task excluded (dep not met)
        assert!(!slug_names(&result).contains(&"blocked-task".to_string()));

        // unplanned excluded
        assert!(!slug_names(&result).contains(&"unplanned".to_string()));

        // checked-backlog excluded
        assert!(!slug_names(&result).contains(&"checked-backlog".to_string()));

        // api-work and db-migration conflict; api-work is P1 so selected, db-migration excluded
        assert!(slug_names(&result).contains(&"api-work".to_string()));
        assert!(!slug_names(&result).contains(&"db-migration".to_string()));

        // ui-work (P1), api-work (P1), ready-dep (P2), docs (P3) should be selected
        assert!(slug_names(&result).contains(&"ui-work".to_string()));
        assert!(slug_names(&result).contains(&"ready-dep".to_string()));
        assert!(slug_names(&result).contains(&"docs".to_string()));

        assert_eq!(result.backlog_slugs.len(), 4);
    }

    #[test]
    fn get_parallelizable_tasks_unidirectional_conflict_forward() {
        // alpha says it conflicts with beta, but beta does NOT list alpha
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] alpha: First [P1] [conflicts: beta] [planned]\n\
             - [ ] beta: Second [P1] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        // alpha is selected first; beta is in alpha's conflicts, so beta is excluded
        assert_eq!(slug_names(&result), vec!["alpha"]);
    }

    #[test]
    fn get_parallelizable_tasks_unidirectional_conflict_reverse() {
        // alpha has no conflicts, beta says it conflicts with alpha
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] alpha: First [P1] [planned]\n\
             - [ ] beta: Second [P1] [conflicts: alpha] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        // alpha selected first (no conflicts). beta conflicts with alpha, so excluded.
        assert_eq!(slug_names(&result), vec!["alpha"]);
    }

    #[test]
    fn get_parallelizable_tasks_multiple_deps_partially_met() {
        let dir = create_tasks_md(
            "## Active Tasks\n\
             - [x] dep-a: Done [P1]\n\n\
             ## Backlog\n\
             - [ ] needs-both: Needs two deps [P1] [depends: dep-a, dep-b] [planned]\n\
             - [ ] needs-one: Needs one dep [P1] [depends: dep-a] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        // needs-both excluded because dep-b is not checked; needs-one included
        assert_eq!(slug_names(&result), vec!["needs-one"]);
        assert_eq!(result.total_groomed, 2);
    }

    #[test]
    fn get_parallelizable_tasks_no_backlog_section() {
        let dir = create_tasks_md(
            "# TASKS\n\n## Active\n\
             - [ ] task: Something [P1] [planned]\n\n## Done\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(result.active_slugs.is_empty());
        assert!(result.backlog_slugs.is_empty());
        assert_eq!(result.total_groomed, 0);
    }

    #[test]
    fn parse_task_line_indented_line() {
        // Lines with leading whitespace should still parse (implementation calls trim())
        let result = parse_task_line("  - [ ] slug: Description [P1] [planned]");
        assert!(result.is_some());
        assert_eq!(result.unwrap().slug, "slug");
    }

    #[test]
    fn parse_task_line_with_tier_tag() {
        let result = parse_task_line("- [ ] my-task: Description [P1] [planned] [tier: opus:high]");
        let task = result.unwrap();
        assert_eq!(task.tier, Some("opus:high".to_string()));
    }

    #[test]
    fn parse_task_line_without_tier_tag() {
        let result = parse_task_line("- [ ] my-task: Description [P1] [planned]");
        let task = result.unwrap();
        assert_eq!(task.tier, None);
    }

    #[test]
    fn parse_task_line_with_empty_tier_tag() {
        let result = parse_task_line("- [ ] my-task: Description [P1] [planned] [tier: ]");
        let task = result.unwrap();
        assert_eq!(task.tier, None);
    }

    #[test]
    fn parse_task_line_with_model_only_tier() {
        let result = parse_task_line("- [ ] my-task: Description [planned] [tier: sonnet]");
        let task = result.unwrap();
        assert_eq!(task.tier, Some("sonnet".to_string()));
    }

    #[test]
    fn get_parallelizable_tasks_returns_tier_per_slug() {
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] task-a: Task A [P1] [planned] [tier: opus:high]\n\
             - [ ] task-b: Task B [P2] [planned] [tier: sonnet:medium]\n\
             - [ ] task-c: Task C [P3] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.backlog_slugs.len(), 3);
        assert_eq!(result.backlog_slugs[0].slug, "task-a");
        assert_eq!(result.backlog_slugs[0].tier, Some("opus:high".to_string()));
        assert_eq!(result.backlog_slugs[1].slug, "task-b");
        assert_eq!(result.backlog_slugs[1].tier, Some("sonnet:medium".to_string()));
        assert_eq!(result.backlog_slugs[2].slug, "task-c");
        assert_eq!(result.backlog_slugs[2].tier, None);
    }

    #[test]
    fn get_parallelizable_tasks_conflict_with_nonexistent_slug() {
        // Task lists a conflict with a slug that isn't a candidate; should still be selected
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] task-a: First [P1] [conflicts: nonexistent] [planned]\n\
             - [ ] task-b: Second [P2] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["task-a", "task-b"]);
    }

    #[test]
    fn get_parallelizable_tasks_includes_active_tasks() {
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### my-active-task\n\
             Some description\n\n\
             ## Backlog\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["my-active-task"]);
        assert_eq!(result.total_groomed, 0); // active tasks don't count as groomed
    }

    #[test]
    fn get_parallelizable_tasks_active_before_backlog() {
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### active-slug\n\n\
             ## Backlog\n\
             - [ ] backlog-slug: Backlog task [P1] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["active-slug", "backlog-slug"]);
        assert_eq!(result.total_groomed, 1);
    }

    #[test]
    fn get_parallelizable_tasks_active_with_backlog_no_cap() {
        // Backend cap removed: all five active slugs plus the backlog task come through.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### a1\n\
             ### a2\n\
             ### a3\n\
             ### a4\n\
             ### a5\n\n\
             ## Backlog\n\
             - [ ] backlog-task: Now also returned [P1] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["a1", "a2", "a3", "a4", "a5", "backlog-task"]);
        assert_eq!(result.total_groomed, 1);
    }

    #[test]
    fn get_parallelizable_tasks_active_no_backend_cap() {
        // Backend no longer truncates active slugs — all seven come through.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### a1\n\
             ### a2\n\
             ### a3\n\
             ### a4\n\
             ### a5\n\
             ### a6\n\
             ### a7\n\n\
             ## Backlog\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(slug_names(&result), vec!["a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
    }

    #[test]
    fn get_parallelizable_tasks_active_plus_backlog_full_passthrough() {
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### active-1\n\
             ### active-2\n\n\
             ## Backlog\n\
             - [ ] b1: First [P1] [planned]\n\
             - [ ] b2: Second [P2] [planned]\n\
             - [ ] b3: Third [P3] [planned]\n\
             - [ ] b4: Fourth [P3] [planned]\n"
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        // No backend cap — all 2 active + 4 backlog returned.
        assert_eq!(slug_names(&result), vec!["active-1", "active-2", "b1", "b2", "b3", "b4"]);
        assert_eq!(result.total_groomed, 4);
    }

    // --- (existing) scan_all_projects_collects_repos_from_multiple_branches ---

    #[test]
    fn scan_all_projects_collects_repos_from_multiple_branches() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("workspace");
        std::fs::create_dir(&ws).unwrap();

        // Branch A: ws/frontend/app (repo)
        let frontend = ws.join("frontend");
        std::fs::create_dir(&frontend).unwrap();
        let app = frontend.join("app");
        std::fs::create_dir(&app).unwrap();
        std::fs::create_dir(app.join(".git")).unwrap();

        // Branch B: ws/backend/services/api (repo)
        let services = ws.join("backend").join("services");
        std::fs::create_dir_all(&services).unwrap();
        let api = services.join("api");
        std::fs::create_dir(&api).unwrap();
        std::fs::create_dir(api.join(".git")).unwrap();

        // Direct child: ws/docs-site (repo)
        let docs = ws.join("docs-site");
        std::fs::create_dir(&docs).unwrap();
        std::fs::create_dir(docs.join(".git")).unwrap();

        let result = scan_all_projects(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_workspace);
        let names: Vec<&str> = result[0].children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names.len(), 3);
        assert!(names.contains(&"app"));
        assert!(names.contains(&"api"));
        assert!(names.contains(&"docs-site"));
    }

    // --- mode tag parsing ---

    #[test]
    fn parse_task_line_with_code_mode() {
        let task = parse_task_line("- [ ] my-task: Description [P1] [planned] [code]").unwrap();
        assert_eq!(task.mode, Some("code".to_string()));
    }

    #[test]
    fn parse_task_line_with_design_mode() {
        let task = parse_task_line("- [ ] my-task: Description [P1] [planned] [design]").unwrap();
        assert_eq!(task.mode, Some("design".to_string()));
    }

    #[test]
    fn parse_task_line_with_manual_mode() {
        let task = parse_task_line("- [ ] my-task: Description [P1] [planned] [manual]").unwrap();
        assert_eq!(task.mode, Some("manual".to_string()));
    }

    #[test]
    fn parse_task_line_with_reggie_system_mode() {
        let task =
            parse_task_line("- [ ] my-task: Description [P1] [planned] [reggie-system]").unwrap();
        assert_eq!(task.mode, Some("reggie-system".to_string()));
    }

    #[test]
    fn parse_task_line_with_debug_mode() {
        let task = parse_task_line("- [ ] my-task: Description [P1] [planned] [debug]").unwrap();
        assert_eq!(task.mode, Some("debug".to_string()));
    }

    #[test]
    fn parse_task_line_no_mode_tag_is_none() {
        let task = parse_task_line("- [ ] my-task: Description [P1] [planned]").unwrap();
        assert_eq!(task.mode, None);
    }

    #[test]
    fn parse_task_line_unknown_bracket_does_not_set_mode() {
        let task = parse_task_line("- [ ] my-task: Description [P1] [planned] [whatever]").unwrap();
        assert_eq!(task.mode, None);
    }

    #[test]
    fn get_parallelizable_tasks_excludes_manual_mode() {
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] code-task: A code task [P1] [planned] [code]\n\
             - [ ] manual-task: A manual task [P1] [planned] [manual]\n\
             - [ ] debug-task: A debug task [P1] [planned] [debug]\n\
             - [ ] reggie-task: A reggie-system task [P1] [planned] [reggie-system]\n",
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        let names = slug_names(&result);
        assert!(names.contains(&"code-task".to_string()));
        assert!(names.contains(&"debug-task".to_string()));
        assert!(names.contains(&"reggie-task".to_string()));
        assert!(!names.contains(&"manual-task".to_string()));
        // total_groomed also excludes manual tasks
        assert_eq!(result.total_groomed, 3);
    }

    #[test]
    fn get_parallelizable_tasks_propagates_mode_to_slug() {
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] code-task: A [P1] [planned] [code]\n\
             - [ ] debug-task: B [P1] [planned] [debug]\n\
             - [ ] reggie-task: C [P1] [planned] [reggie-system]\n\
             - [ ] no-mode: D [P1] [planned]\n",
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        let by_slug: std::collections::HashMap<&str, Option<&str>> = result
            .backlog_slugs
            .iter()
            .map(|s| (s.slug.as_str(), s.mode.as_deref()))
            .collect();
        assert_eq!(by_slug.get("code-task"), Some(&Some("code")));
        assert_eq!(by_slug.get("debug-task"), Some(&Some("debug")));
        assert_eq!(by_slug.get("reggie-task"), Some(&Some("reggie-system")));
        assert_eq!(by_slug.get("no-mode"), Some(&None));
    }

    // --- active/backlog split + cross-domain dispatch regression tests ---

    #[test]
    fn get_parallelizable_tasks_splits_active_and_backlog() {
        // One active `### header` slug + one backlog task → exactly one in each list.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### my-active\n\n\
             ## Backlog\n\
             - [ ] my-backlog: A backlog task [P1] [planned]\n",
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.active_slugs.len(), 1);
        assert_eq!(result.active_slugs[0].slug, "my-active");
        assert_eq!(result.backlog_slugs.len(), 1);
        assert_eq!(result.backlog_slugs[0].slug, "my-backlog");
    }

    #[test]
    fn get_parallelizable_tasks_active_mode_from_cross_reference() {
        // The original tagged entry for `my-active` lives in `## Done` as a
        // checked `[debug]` task. The cross-reference pass should populate
        // `mode = Some("debug")` on the active slug.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### my-active\n\n\
             ## Backlog\n\n\
             ## Done\n\
             - [x] my-active: An old debug task [P1] [planned] [debug]\n",
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.active_slugs.len(), 1);
        assert_eq!(result.active_slugs[0].slug, "my-active");
        assert_eq!(result.active_slugs[0].mode, Some("debug".to_string()));
    }

    #[test]
    fn get_parallelizable_tasks_active_mode_none_when_unmatched() {
        // No original entry anywhere in the file for the active slug → mode None.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### orphan-slug\n\n\
             ## Backlog\n",
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.active_slugs.len(), 1);
        assert_eq!(result.active_slugs[0].slug, "orphan-slug");
        assert_eq!(result.active_slugs[0].mode, None);
    }

    #[test]
    fn get_parallelizable_tasks_active_section_drops_cr_slug() {
        // A `### slug` line containing a CR must be silently dropped.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### bad\rslug\n\n\
             ### good-slug\n\n\
             ## Backlog\n",
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.active_slugs.len(), 1);
        assert_eq!(result.active_slugs[0].slug, "good-slug");
    }

    #[test]
    fn get_parallelizable_tasks_conflict_prune_does_not_drop_cross_domain_backlog() {
        // Live regression: an active code slug + a backlog `[debug]` task that
        // lists the active slug in `[conflicts: ...]`. Previously the prune
        // seeded `selected` with active_slugs and silently dropped the debug
        // task. After the fix the backlog task must survive.
        let dir = create_tasks_md(
            "## Active Tasks\n\
             ### code-active\n\n\
             ## Backlog\n\
             - [ ] debug-task: Cross-domain debug [P1] [conflicts: code-active] [planned] [debug]\n",
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.active_slugs.len(), 1);
        assert_eq!(result.active_slugs[0].slug, "code-active");
        assert_eq!(
            backlog_slug_names(&result),
            vec!["debug-task".to_string()],
            "backlog task must survive cross-domain conflict against active slug",
        );
    }

    #[test]
    fn get_parallelizable_tasks_conflict_prune_within_backlog_still_works() {
        // Backlog-vs-backlog conflict prune is preserved on purpose.
        let dir = create_tasks_md(
            "## Backlog\n\
             - [ ] first: Higher in priority order [P1] [conflicts: second] [planned]\n\
             - [ ] second: Loses the prune [P1] [conflicts: first] [planned]\n",
        );
        let result = get_parallelizable_tasks(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(
            backlog_slug_names(&result),
            vec!["first".to_string()],
            "in-backlog conflicts still prune the lower-precedence task",
        );
    }

    #[test]
    fn parse_tasks_in_file_propagates_mode_on_groomed_items() {
        let content = "## Backlog\n\
             - [ ] code-task: A [P1] [planned] [code]\n\
             - [ ] manual-task: B [P1] [planned] [manual]\n\
             - [ ] debug-task: C [P1] [planned] [debug]\n";
        let parsed = parse_tasks_in_file(content);
        assert_eq!(parsed.groomed_tasks.len(), 3);
        let by_slug: std::collections::HashMap<&str, Option<&str>> = parsed
            .groomed_tasks
            .iter()
            .map(|t| (t.slug.as_str(), t.mode.as_deref()))
            .collect();
        assert_eq!(by_slug.get("code-task"), Some(&Some("code")));
        assert_eq!(by_slug.get("manual-task"), Some(&Some("manual")));
        assert_eq!(by_slug.get("debug-task"), Some(&Some("debug")));
    }

    #[test]
    fn parse_tasks_in_file_active_tasks_have_no_mode() {
        let content = "## Active Tasks\n\
             ### active-1\n\
             ### active-2\n\n\
             ## Backlog\n";
        let parsed = parse_tasks_in_file(content);
        assert_eq!(parsed.active_tasks.len(), 2);
        for t in &parsed.active_tasks {
            assert_eq!(t.mode, None);
        }
    }

    // --- count_tasks_in_file ---

    #[test]
    fn count_tasks_empty_content() {
        let (ungroomed, groomed, active) = count_tasks_in_file("");
        assert_eq!((ungroomed, groomed, active), (0, 0, 0));
    }

    #[test]
    fn count_tasks_active_tasks() {
        let content = "\
## Active Tasks

### my-task
**Task**: Do something
- [ ] sub-task: A subtask [P1]

---

## Backlog
";
        let (ungroomed, groomed, active) = count_tasks_in_file(content);
        assert_eq!(active, 1);
        assert_eq!(ungroomed, 0);
        assert_eq!(groomed, 0);
    }

    #[test]
    fn count_tasks_backlog_planned_vs_unplanned() {
        let content = "\
## Backlog

- [ ] planned-task: A planned task [P1] [planned]
- [ ] unplanned-task: An unplanned task [P2]
";
        let (ungroomed, groomed, _active) = count_tasks_in_file(content);
        assert_eq!(groomed, 1);
        assert_eq!(ungroomed, 1);
    }

    #[test]
    fn count_tasks_ungroomed_subsection() {
        let content = "\
## Backlog

### Ungroomed

- [ ] raw-idea: Just an idea [planned]
- [ ] another: Another idea

### Feature Group

- [ ] feature-task: A feature [planned]
";
        let (ungroomed, groomed, _active) = count_tasks_in_file(content);
        // Both tasks in ### Ungroomed count as ungroomed regardless of [planned] tag
        assert_eq!(ungroomed, 2);
        assert_eq!(groomed, 1);
    }

    #[test]
    fn count_tasks_checked_tasks_excluded() {
        let content = "\
## Backlog

- [x] done-task: Already done [planned]
- [ ] todo-task: Still todo [planned]
";
        let (ungroomed, groomed, _active) = count_tasks_in_file(content);
        assert_eq!(groomed, 1);
        assert_eq!(ungroomed, 0);
    }

    #[test]
    fn count_tasks_mixed_sections() {
        let content = "\
## Active Tasks

### running-task
**Task**: Running
- [ ] active-sub: Something [P1]

---

## Backlog

### Feature Work

- [ ] groomed-1: First groomed [P1] [planned]
- [ ] groomed-2: Second groomed [P2] [planned]
- [x] done-groomed: Already done [planned]
- [ ] ungroomed-1: Not planned yet

### Ungroomed

- [ ] raw-1: Raw idea 1
- [ ] raw-2: Raw idea 2 [planned]
";
        let (ungroomed, groomed, active) = count_tasks_in_file(content);
        assert_eq!(active, 1);
        assert_eq!(groomed, 2);
        assert_eq!(ungroomed, 3); // 1 unplanned in Feature Work + 2 in Ungroomed
    }

    // --- bare-dash ungroomed tests ---

    #[test]
    fn count_tasks_bare_dash_in_ungroomed_counted() {
        let content = "\
## Backlog

### Ungroomed

- Fix the auth bug
- Add dark mode
";
        let (ungroomed, groomed, _active) = count_tasks_in_file(content);
        assert_eq!(ungroomed, 2);
        assert_eq!(groomed, 0);
    }

    #[test]
    fn count_tasks_bare_dash_in_other_section_ignored() {
        let content = "\
## Backlog

### Feature Work

- Fix the auth bug
- [ ] real-task: Real task [planned]

### Later Features

- need to add git viewer
";
        let (ungroomed, groomed, _active) = count_tasks_in_file(content);
        assert_eq!(groomed, 1); // only the [planned] checkbox line
        assert_eq!(ungroomed, 0); // bare dashes in non-Ungroomed sections ignored
    }

    #[test]
    fn count_tasks_bare_dash_empty_slug_skipped() {
        let content = "\
## Backlog

### Ungroomed

- !!!
- ...
- Fix the bug
";
        let (ungroomed, _groomed, _active) = count_tasks_in_file(content);
        assert_eq!(ungroomed, 1); // only 'Fix the bug' produces a non-empty slug
    }

    #[test]
    fn count_tasks_bare_dash_mixed_with_checkbox() {
        let content = "\
## Backlog

### Ungroomed

- [ ] formal-task: A formal ungroomed task
- Fix the auth bug
- Add dark mode
";
        let (ungroomed, _groomed, _active) = count_tasks_in_file(content);
        assert_eq!(ungroomed, 3); // 1 checkbox + 2 bare-dash
    }

    #[test]
    fn count_tasks_bare_dash_no_double_count_with_checkbox() {
        // Lines that look like checkboxes should NOT be matched by bare-dash fallback
        let content = "\
## Backlog

### Ungroomed

- [ ] task-one: First task
- [x] done-task: Done
";
        let (ungroomed, _groomed, _active) = count_tasks_in_file(content);
        assert_eq!(ungroomed, 1); // only the unchecked checkbox; [x] excluded, no bare-dash double count
    }

    // --- scan_tasks_across_repos ---

    /// Helper to create a git repo directory with an optional TASKS.md file.
    fn make_repo(parent: &Path, name: &str, tasks_content: Option<&str>) -> PathBuf {
        let repo_dir = parent.join(name);
        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::create_dir(repo_dir.join(".git")).unwrap();
        if let Some(content) = tasks_content {
            std::fs::write(repo_dir.join("TASKS.md"), content).unwrap();
        }
        repo_dir
    }

    #[test]
    fn scan_tasks_returns_error_for_nonexistent_path() {
        let result = scan_tasks_across_repos("/nonexistent/path/xyz".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a directory"));
    }

    #[test]
    fn scan_tasks_empty_directory_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let result = scan_tasks_across_repos(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn scan_tasks_standalone_repo_without_tasks_md() {
        let dir = tempfile::tempdir().unwrap();
        make_repo(dir.path(), "my-repo", None);

        let result = scan_tasks_across_repos(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "my-repo");
        assert!(result[0].workspace_name.is_none());
        assert_eq!(result[0].ungroomed_count, 0);
        assert_eq!(result[0].groomed_count, 0);
        assert_eq!(result[0].active_count, 0);
    }

    #[test]
    fn scan_tasks_standalone_repo_with_tasks_md() {
        let dir = tempfile::tempdir().unwrap();
        let tasks = "\
## Active Tasks

### running
**Task**: Something
- [ ] sub: work [P1]

---

## Backlog

- [ ] todo-1: First task [P1] [planned]
- [ ] todo-2: Second task [P2]
";
        make_repo(dir.path(), "project-a", Some(tasks));

        let result = scan_tasks_across_repos(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "project-a");
        assert_eq!(result[0].active_count, 1);
        assert_eq!(result[0].groomed_count, 1);
        assert_eq!(result[0].ungroomed_count, 1);
    }

    #[test]
    fn scan_tasks_workspace_with_child_repos() {
        let dir = tempfile::tempdir().unwrap();
        // Create a workspace directory (not itself a git repo) containing child repos
        let ws = dir.path().join("my-workspace");
        std::fs::create_dir_all(&ws).unwrap();

        let child_tasks = "\
## Backlog

- [ ] task-a: A task [planned]
- [ ] task-b: B task
";
        make_repo(&ws, "child-1", Some(child_tasks));
        make_repo(&ws, "child-2", None);

        let result = scan_tasks_across_repos(dir.path().to_string_lossy().to_string()).unwrap();
        // Should have 2 entries (one per child repo in the workspace)
        assert_eq!(result.len(), 2);

        let child1 = result.iter().find(|r| r.name == "child-1").unwrap();
        assert_eq!(child1.workspace_name, Some("my-workspace".to_string()));
        assert_eq!(child1.groomed_count, 1);
        assert_eq!(child1.ungroomed_count, 1);

        let child2 = result.iter().find(|r| r.name == "child-2").unwrap();
        assert_eq!(child2.workspace_name, Some("my-workspace".to_string()));
        assert_eq!(child2.groomed_count, 0);
        assert_eq!(child2.ungroomed_count, 0);
    }

    #[test]
    fn scan_tasks_multiple_standalone_repos() {
        let dir = tempfile::tempdir().unwrap();
        make_repo(dir.path(), "alpha", Some("## Backlog\n\n- [ ] t: task\n"));
        make_repo(dir.path(), "beta", Some("## Backlog\n\n- [ ] t: task [planned]\n"));

        let result = scan_tasks_across_repos(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 2);

        let alpha = result.iter().find(|r| r.name == "alpha").unwrap();
        assert!(alpha.workspace_name.is_none());
        assert_eq!(alpha.ungroomed_count, 1);

        let beta = result.iter().find(|r| r.name == "beta").unwrap();
        assert!(beta.workspace_name.is_none());
        assert_eq!(beta.groomed_count, 1);
    }

    // --- append_ungroomed_tasks tests ---

    /// Build a `TaskWithAttachments` with no attachments — keeps the existing
    /// tests focused on the description-handling behavior they were written to
    /// exercise.
    fn task(desc: &str) -> TaskWithAttachments {
        TaskWithAttachments {
            description: desc.to_string(),
            attachments: Vec::new(),
        }
    }

    #[test]
    fn append_tasks_creates_file_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();

        append_ungroomed_tasks(project.clone(), vec![task("Fix the bug")]).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(content.contains("# Tasks"));
        assert!(content.contains("## Backlog"));
        assert!(content.contains("### Ungroomed"));
        assert!(content.contains("- [ ] fix-the-bug: Fix the bug"));
    }

    #[test]
    fn append_tasks_adds_to_existing_ungroomed_section() {
        let dir = tempfile::tempdir().unwrap();
        let tasks_content = "# Tasks\n\n## Backlog\n\n### Ungroomed\n- [ ] Existing task\n";
        std::fs::write(dir.path().join("TASKS.md"), tasks_content).unwrap();

        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task("New task one"), task("New task two")],
        ).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(content.contains("- [ ] new-task-one: New task one"));
        assert!(content.contains("- [ ] new-task-two: New task two"));
        assert!(content.contains("- [ ] Existing task"));
        // New tasks should appear before existing ones (inserted right after heading)
        let new_pos = content.find("New task one").unwrap();
        let existing_pos = content.find("Existing task").unwrap();
        assert!(new_pos < existing_pos);
    }

    #[test]
    fn append_tasks_creates_ungroomed_section_when_backlog_exists() {
        let dir = tempfile::tempdir().unwrap();
        let tasks_content = "# Tasks\n\n## Backlog\n\n### Groomed\n- [ ] groomed-task: Do something\n";
        std::fs::write(dir.path().join("TASKS.md"), tasks_content).unwrap();

        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task("Ungroomed item")],
        ).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(content.contains("### Ungroomed"));
        assert!(content.contains("- [ ] ungroomed-item: Ungroomed item"));
    }

    #[test]
    fn append_tasks_creates_backlog_and_ungroomed_when_neither_exists() {
        let dir = tempfile::tempdir().unwrap();
        let tasks_content = "# Tasks\n\nSome random content.\n";
        std::fs::write(dir.path().join("TASKS.md"), tasks_content).unwrap();

        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task("My task")],
        ).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(content.contains("## Backlog"));
        assert!(content.contains("### Ungroomed"));
        assert!(content.contains("- [ ] my-task: My task"));
    }

    #[test]
    fn append_tasks_skips_empty_and_whitespace_tasks() {
        let dir = tempfile::tempdir().unwrap();

        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task("  "), task(""), task("Real task")],
        ).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(content.contains("- [ ] real-task: Real task"));
        // Should only have one task line
        let task_count = content.matches("- [ ]").count();
        assert_eq!(task_count, 1);
    }

    #[test]
    fn append_tasks_skips_all_special_char_tasks() {
        let dir = tempfile::tempdir().unwrap();

        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task("!@#$%"), task("Real task")],
        ).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(content.contains("- [ ] real-task: Real task"));
        // All-special task should be skipped, only one task line
        let task_count = content.matches("- [ ]").count();
        assert_eq!(task_count, 1);
    }

    #[test]
    fn append_tasks_noop_when_empty_list() {
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![],
        ).unwrap();

        // File should not be created
        assert!(!dir.path().join("TASKS.md").exists());
    }

    // --- to_kebab_case ---

    #[test]
    fn to_kebab_case_basic() {
        assert_eq!(to_kebab_case("Fix the bug"), "fix-the-bug");
    }

    #[test]
    fn to_kebab_case_special_chars() {
        assert_eq!(to_kebab_case("Add (dark) mode!"), "add-dark-mode");
    }

    #[test]
    fn to_kebab_case_multiple_spaces() {
        assert_eq!(to_kebab_case("Fix   the   bug"), "fix-the-bug");
    }

    #[test]
    fn to_kebab_case_numbers() {
        assert_eq!(to_kebab_case("Add v2 support"), "add-v2-support");
    }

    #[test]
    fn to_kebab_case_already_kebab() {
        assert_eq!(to_kebab_case("already-kebab-case"), "already-kebab-case");
    }

    #[test]
    fn to_kebab_case_leading_trailing_special() {
        assert_eq!(to_kebab_case("  --Fix it!--  "), "fix-it");
    }

    #[test]
    fn to_kebab_case_empty() {
        assert_eq!(to_kebab_case(""), "");
    }

    #[test]
    fn to_kebab_case_unicode_chars() {
        // Unicode alphanumeric chars are preserved by is_alphanumeric()
        assert_eq!(to_kebab_case("Café résumé"), "café-résumé");
    }

    #[test]
    fn to_kebab_case_numbers_only() {
        assert_eq!(to_kebab_case("123"), "123");
    }

    #[test]
    fn to_kebab_case_single_word() {
        assert_eq!(to_kebab_case("Refactor"), "refactor");
    }

    #[test]
    fn to_kebab_case_all_special_chars() {
        // All non-alphanumeric chars produce hyphens which get trimmed
        assert_eq!(to_kebab_case("!@#$%^&*()"), "");
    }

    #[test]
    fn to_kebab_case_colon_in_text() {
        // Colon is not alphanumeric, should become hyphen
        assert_eq!(to_kebab_case("Fix: the bug"), "fix-the-bug");
    }

    // --- Round-trip: append_ungroomed_tasks output is parseable ---

    #[test]
    fn appended_tasks_are_parseable_by_parse_task_line() {
        // This is the core property of the fix: tasks written by append_ungroomed_tasks
        // must be parseable by parse_task_line so they show up in the UI.
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task("Fix the login bug"), task("Add dark mode")],
        ).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        let parsed: Vec<TaskEntry> = content.lines()
            .filter_map(parse_task_line)
            .collect();

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].slug, "fix-the-login-bug");
        assert_eq!(parsed[0].description, "Fix the login bug");
        assert!(!parsed[0].checked);
        assert_eq!(parsed[1].slug, "add-dark-mode");
        assert_eq!(parsed[1].description, "Add dark mode");
        assert!(!parsed[1].checked);
    }

    #[test]
    fn appended_tasks_are_counted_by_count_tasks_in_file() {
        // Verify the end-to-end: append tasks -> count_tasks_in_file sees them as ungroomed.
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task("Task one"), task("Task two"), task("Task three")],
        ).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        let (ungroomed, groomed, active) = count_tasks_in_file(&content);

        assert_eq!(ungroomed, 3);
        assert_eq!(groomed, 0);
        assert_eq!(active, 0);
    }

    #[test]
    fn appended_task_with_colon_in_description_is_parseable() {
        // Tasks whose descriptions contain colons must still parse correctly.
        // The slug (derived from to_kebab_case) won't contain a colon, so
        // parse_task_line's first-colon split still works.
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task("Fix: the auth flow")],
        ).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        let parsed: Vec<TaskEntry> = content.lines()
            .filter_map(parse_task_line)
            .collect();

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].slug, "fix-the-auth-flow");
        // Description is everything after the first colon, which is " the auth flow"
        // Wait -- the written line is "- [ ] fix-the-auth-flow: Fix: the auth flow"
        // parse_task_line: rest = "fix-the-auth-flow: Fix: the auth flow"
        //   colon_pos = 17 (after "fix-the-auth-flow")
        //   after_colon = " Fix: the auth flow"
        //   description = "Fix: the auth flow"
        assert_eq!(parsed[0].description, "Fix: the auth flow");
    }

    #[test]
    fn appended_tasks_into_existing_file_are_counted_correctly() {
        // Append into an existing file that already has groomed tasks, then verify counts.
        let dir = tempfile::tempdir().unwrap();
        let existing = "\
# Tasks

## Backlog

### Groomed

- [ ] existing-task: An existing groomed task [P1] [planned]

### Ungroomed
";
        std::fs::write(dir.path().join("TASKS.md"), existing).unwrap();

        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task("New ungroomed task")],
        ).unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        let (ungroomed, groomed, active) = count_tasks_in_file(&content);

        assert_eq!(ungroomed, 1);
        assert_eq!(groomed, 1);
        assert_eq!(active, 0);
    }

    // --- save_attachment_image / cleanup_attachments / list_orphan_attachments tests ---

    fn attachment(label: &str, path: &str) -> TaskAttachment {
        TaskAttachment {
            label: label.to_string(),
            path: path.to_string(),
        }
    }

    fn task_with(desc: &str, attachments: Vec<TaskAttachment>) -> TaskWithAttachments {
        TaskWithAttachments {
            description: desc.to_string(),
            attachments,
        }
    }

    // --- save_attachment_image ---

    #[test]
    fn save_attachment_image_writes_first_file_with_index_one() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();

        let result = save_attachment_image(
            project.clone(),
            "fix-foo-a3b4c5".to_string(),
            "png".to_string(),
            vec![1, 2, 3, 4],
        )
        .unwrap();

        assert_eq!(result.label_index, 1);
        assert_eq!(result.path, ".reggie/attachments/fix-foo-a3b4c5/1.png");

        let written = dir
            .path()
            .join(".reggie/attachments/fix-foo-a3b4c5/1.png");
        assert!(written.exists());
        let bytes = std::fs::read(&written).unwrap();
        assert_eq!(bytes, vec![1, 2, 3, 4]);
    }

    #[test]
    fn save_attachment_image_increments_index_on_second_call_same_dir() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();

        save_attachment_image(
            project.clone(),
            "task-abc123".to_string(),
            "png".to_string(),
            vec![0xAA],
        )
        .unwrap();
        let second = save_attachment_image(
            project.clone(),
            "task-abc123".to_string(),
            "png".to_string(),
            vec![0xBB],
        )
        .unwrap();

        assert_eq!(second.label_index, 2);
        assert_eq!(second.path, ".reggie/attachments/task-abc123/2.png");
        let bytes = std::fs::read(dir.path().join(".reggie/attachments/task-abc123/2.png")).unwrap();
        assert_eq!(bytes, vec![0xBB]);
    }

    #[test]
    fn save_attachment_image_creates_gitignore_on_first_save() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();

        save_attachment_image(
            project,
            "task-xyz789".to_string(),
            "jpg".to_string(),
            vec![1],
        )
        .unwrap();

        let gitignore = dir.path().join(".reggie/attachments/.gitignore");
        assert!(gitignore.exists());
        let content = std::fs::read_to_string(&gitignore).unwrap();
        // Accept the implementation's chosen variant.
        assert!(content == "*\n!.gitignore" || content == "*\n!.gitignore\n");
    }

    #[test]
    fn save_attachment_image_preserves_existing_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let attachments_root = dir.path().join(".reggie/attachments");
        std::fs::create_dir_all(&attachments_root).unwrap();
        let custom = "# user-customized\nfoo\n";
        std::fs::write(attachments_root.join(".gitignore"), custom).unwrap();

        save_attachment_image(
            project,
            "task-keep-mine".to_string(),
            "png".to_string(),
            vec![9],
        )
        .unwrap();

        let after = std::fs::read_to_string(attachments_root.join(".gitignore")).unwrap();
        assert_eq!(after, custom);
    }

    #[test]
    fn save_attachment_image_creates_parent_dirs_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        // Sanity: .reggie does not exist yet.
        assert!(!dir.path().join(".reggie").exists());

        save_attachment_image(project, "task-fresh".to_string(), "png".to_string(), vec![1])
            .unwrap();

        assert!(dir.path().join(".reggie/attachments/task-fresh/1.png").exists());
    }

    #[test]
    fn save_attachment_image_rejects_heic_extension() {
        let dir = tempfile::tempdir().unwrap();
        let err = save_attachment_image(
            dir.path().to_string_lossy().to_string(),
            "task-1".to_string(),
            "heic".to_string(),
            vec![1],
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("heic") || err.to_lowercase().contains("unsupported"));
        assert!(!dir.path().join(".reggie").exists(), "no dirs should be created on rejected ext");
    }

    #[test]
    fn save_attachment_image_rejects_exe_extension() {
        let dir = tempfile::tempdir().unwrap();
        let err = save_attachment_image(
            dir.path().to_string_lossy().to_string(),
            "task-1".to_string(),
            "exe".to_string(),
            vec![1],
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("exe") || err.to_lowercase().contains("unsupported"));
    }

    #[test]
    fn save_attachment_image_rejects_path_traversal_dir_name() {
        let dir = tempfile::tempdir().unwrap();
        let err = save_attachment_image(
            dir.path().to_string_lossy().to_string(),
            "../foo".to_string(),
            "png".to_string(),
            vec![1],
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("invalid") || err.to_lowercase().contains("dir name"));
        // Confirm nothing was written outside the project dir.
        assert!(!dir.path().parent().unwrap().join("foo").exists());
    }

    #[test]
    fn save_attachment_image_rejects_path_separator_dir_name() {
        let dir = tempfile::tempdir().unwrap();
        let err = save_attachment_image(
            dir.path().to_string_lossy().to_string(),
            "foo/bar".to_string(),
            "png".to_string(),
            vec![1],
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("invalid") || err.to_lowercase().contains("dir name"));
    }

    #[test]
    fn save_attachment_image_rejects_empty_dir_name() {
        let dir = tempfile::tempdir().unwrap();
        let err = save_attachment_image(
            dir.path().to_string_lossy().to_string(),
            "".to_string(),
            "png".to_string(),
            vec![1],
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("invalid") || err.to_lowercase().contains("dir name"));
    }

    #[test]
    fn save_attachment_image_accepts_uppercase_extension_case_insensitively() {
        let dir = tempfile::tempdir().unwrap();
        let result = save_attachment_image(
            dir.path().to_string_lossy().to_string(),
            "task-cap".to_string(),
            "PNG".to_string(),
            vec![7, 7, 7],
        )
        .unwrap();

        // Stored extension should be lowercase.
        assert_eq!(result.path, ".reggie/attachments/task-cap/1.png");
        assert!(dir.path().join(".reggie/attachments/task-cap/1.png").exists());
    }

    #[test]
    fn save_attachment_image_path_uses_forward_slashes() {
        let dir = tempfile::tempdir().unwrap();
        let result = save_attachment_image(
            dir.path().to_string_lossy().to_string(),
            "task-slash".to_string(),
            "png".to_string(),
            vec![1],
        )
        .unwrap();

        assert!(!result.path.contains('\\'), "path must not contain backslashes");
        assert!(result.path.contains('/'));
    }

    // --- cleanup_attachments ---

    #[test]
    fn cleanup_attachments_deletes_existing_dirs_and_returns_count() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        save_attachment_image(project.clone(), "a-aaa111".to_string(), "png".to_string(), vec![1])
            .unwrap();
        save_attachment_image(project.clone(), "b-bbb222".to_string(), "png".to_string(), vec![2])
            .unwrap();

        let removed = cleanup_attachments(
            project,
            vec!["a-aaa111".to_string(), "b-bbb222".to_string()],
        )
        .unwrap();

        assert_eq!(removed, 2);
        assert!(!dir.path().join(".reggie/attachments/a-aaa111").exists());
        assert!(!dir.path().join(".reggie/attachments/b-bbb222").exists());
    }

    #[test]
    fn cleanup_attachments_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        save_attachment_image(project.clone(), "task-once".to_string(), "png".to_string(), vec![1])
            .unwrap();

        let first = cleanup_attachments(project.clone(), vec!["task-once".to_string()]).unwrap();
        let second = cleanup_attachments(project, vec!["task-once".to_string()]).unwrap();

        assert_eq!(first, 1);
        assert_eq!(second, 0);
    }

    #[test]
    fn cleanup_attachments_silent_on_missing_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        // Attachments root does not exist yet — no error.
        let removed =
            cleanup_attachments(project, vec!["never-existed".to_string()]).unwrap();
        assert_eq!(removed, 0);
    }

    #[test]
    fn cleanup_attachments_rejects_unsafe_dir_name() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let err = cleanup_attachments(project, vec!["../escape".to_string()]).unwrap_err();
        assert!(err.to_lowercase().contains("invalid") || err.to_lowercase().contains("dir name"));
    }

    // --- list_orphan_attachments ---

    #[test]
    fn list_orphan_attachments_empty_when_attachments_dir_missing() {
        let dir = tempfile::tempdir().unwrap();
        let orphans =
            list_orphan_attachments(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(orphans.is_empty());
    }

    #[test]
    fn list_orphan_attachments_empty_when_all_dirs_referenced() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        save_attachment_image(project.clone(), "task-aaa111".to_string(), "png".to_string(), vec![1])
            .unwrap();

        // Reference the dir from TASKS.md.
        std::fs::write(
            dir.path().join("TASKS.md"),
            "# Tasks\n\n## Backlog\n\n### Ungroomed\n\
             - [ ] task-aaa111: do thing\n\
             \x20\x20> attachments: [Image 1]=.reggie/attachments/task-aaa111/1.png\n",
        )
        .unwrap();

        let orphans = list_orphan_attachments(project).unwrap();
        assert!(orphans.is_empty(), "expected no orphans, got {:?}", orphans);
    }

    #[test]
    fn list_orphan_attachments_returns_unreferenced_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        save_attachment_image(project.clone(), "kept-aaa".to_string(), "png".to_string(), vec![1])
            .unwrap();
        save_attachment_image(project.clone(), "orphan-bbb".to_string(), "png".to_string(), vec![2])
            .unwrap();

        // Only reference `kept-aaa` in TASKS.md.
        std::fs::write(
            dir.path().join("TASKS.md"),
            "### Ungroomed\n\
             - [ ] kept-aaa: keep\n\
             \x20\x20> attachments: [Image 1]=.reggie/attachments/kept-aaa/1.png\n",
        )
        .unwrap();

        let orphans = list_orphan_attachments(project).unwrap();
        assert_eq!(orphans, vec!["orphan-bbb".to_string()]);
    }

    #[test]
    fn list_orphan_attachments_ignores_non_dir_entries_like_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        // Save creates `.gitignore` as a file under `.reggie/attachments/`.
        save_attachment_image(project.clone(), "task-kept".to_string(), "png".to_string(), vec![1])
            .unwrap();
        // No TASKS.md → all dirs are orphans, but `.gitignore` (a file) must be excluded.
        let orphans = list_orphan_attachments(project).unwrap();
        assert_eq!(orphans, vec!["task-kept".to_string()]);
        assert!(!orphans.contains(&".gitignore".to_string()));
    }

    #[test]
    fn list_orphan_attachments_treats_all_as_orphan_when_tasks_md_missing() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        save_attachment_image(project.clone(), "lonely-1".to_string(), "png".to_string(), vec![1])
            .unwrap();
        save_attachment_image(project.clone(), "lonely-2".to_string(), "png".to_string(), vec![2])
            .unwrap();
        // Don't write TASKS.md.
        let mut orphans = list_orphan_attachments(project).unwrap();
        orphans.sort();
        assert_eq!(orphans, vec!["lonely-1".to_string(), "lonely-2".to_string()]);
    }

    #[test]
    fn list_orphan_attachments_handles_malformed_attachment_lines() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        save_attachment_image(project.clone(), "real-dir".to_string(), "png".to_string(), vec![1])
            .unwrap();
        // Malformed lines: missing path, truncated mid-token, weird syntax. Must not panic.
        std::fs::write(
            dir.path().join("TASKS.md"),
            "### Ungroomed\n\
             - [ ] real-dir: ok\n\
             \x20\x20> attachments: [Image 1]=\n\
             \x20\x20> attachments: garbage line\n\
             \x20\x20> attachments: .reggie/attachments/\n\
             \x20\x20> attachments: [Image 2]=.reggie/attachments/real-dir/1.png\n",
        )
        .unwrap();

        let orphans = list_orphan_attachments(project).unwrap();
        assert!(orphans.is_empty(), "real-dir is referenced; got {:?}", orphans);
    }

    // --- append_ungroomed_tasks with attachments ---

    #[test]
    fn append_ungroomed_tasks_emits_attachments_annotation_for_single_image() {
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task_with(
                "Fix login",
                vec![attachment("Image 1", ".reggie/attachments/fix-login-abc123/1.png")],
            )],
        )
        .unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(content.contains("- [ ] fix-login: Fix login\n"));
        assert!(content.contains(
            "  > attachments: [Image 1]=.reggie/attachments/fix-login-abc123/1.png\n"
        ));
    }

    #[test]
    fn append_ungroomed_tasks_omits_annotation_when_no_attachments() {
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task_with("Plain task", vec![])],
        )
        .unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(content.contains("- [ ] plain-task: Plain task"));
        assert!(!content.contains("attachments:"), "no annotation expected, got:\n{}", content);
    }

    #[test]
    fn append_ungroomed_tasks_comma_separates_multiple_attachments_on_one_line() {
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task_with(
                "Two pics",
                vec![
                    attachment("Image 1", ".reggie/attachments/two-pics-zzz/1.png"),
                    attachment("Image 2", ".reggie/attachments/two-pics-zzz/2.jpg"),
                ],
            )],
        )
        .unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(content.contains(
            "  > attachments: [Image 1]=.reggie/attachments/two-pics-zzz/1.png, \
             [Image 2]=.reggie/attachments/two-pics-zzz/2.jpg\n"
        ));
    }

    #[test]
    fn append_ungroomed_tasks_pairs_each_task_with_its_own_annotation() {
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![
                task_with(
                    "Task A",
                    vec![attachment("Image 1", ".reggie/attachments/task-a-aaa/1.png")],
                ),
                task_with("Task B", vec![]),
                task_with(
                    "Task C",
                    vec![attachment("Image 2", ".reggie/attachments/task-c-ccc/1.png")],
                ),
            ],
        )
        .unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        // Find each task's line index; its annotation (if any) should be the next line.
        let lines: Vec<&str> = content.lines().collect();
        let task_a = lines.iter().position(|l| l.starts_with("- [ ] task-a:")).unwrap();
        let task_b = lines.iter().position(|l| l.starts_with("- [ ] task-b:")).unwrap();
        let task_c = lines.iter().position(|l| l.starts_with("- [ ] task-c:")).unwrap();

        assert!(lines[task_a + 1].starts_with("  > attachments: [Image 1]="));
        // Task B has no annotation; the next line is whatever follows (could be Task C).
        assert!(!lines[task_b + 1].starts_with("  > attachments:"));
        assert!(lines[task_c + 1].starts_with("  > attachments: [Image 2]="));
    }

    #[test]
    fn append_ungroomed_tasks_skips_empty_descriptions_even_with_attachments() {
        // If the description trims to empty, no task line and no annotation are emitted.
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![
                task_with(
                    "   ",
                    vec![attachment("Image 1", ".reggie/attachments/dropped/1.png")],
                ),
                task_with("Real one", vec![]),
            ],
        )
        .unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        assert!(!content.contains("attachments:"));
        assert_eq!(content.matches("- [ ]").count(), 1);
        assert!(content.contains("- [ ] real-one: Real one"));
    }

    #[test]
    fn append_ungroomed_tasks_no_regression_on_non_attachment_path() {
        // The byte-for-byte output for a no-attachment task must match the legacy
        // single-line format.
        let dir = tempfile::tempdir().unwrap();
        append_ungroomed_tasks(
            dir.path().to_string_lossy().to_string(),
            vec![task_with("Just words", vec![])],
        )
        .unwrap();

        let content = std::fs::read_to_string(dir.path().join("TASKS.md")).unwrap();
        // Exactly one `- [ ]` line and zero annotation lines.
        assert_eq!(content.matches("- [ ]").count(), 1);
        assert_eq!(content.matches("> attachments:").count(), 0);
    }

    // --- validate_watch_path ---

    #[test]
    fn validate_watch_path_rejects_root() {
        let home = tempfile::tempdir().unwrap();
        let err = validate_watch_path(Path::new("/"), home.path()).unwrap_err();
        assert!(err.contains("too broad"), "got: {}", err);
    }

    #[test]
    fn validate_watch_path_rejects_home() {
        let home = tempfile::tempdir().unwrap();
        let err = validate_watch_path(home.path(), home.path()).unwrap_err();
        assert!(err.contains("too broad"), "got: {}", err);
    }

    #[test]
    fn validate_watch_path_rejects_ancestor_of_home() {
        // Use the parent of a tempdir-based home as the watch target.
        let home = tempfile::tempdir().unwrap();
        let parent = home.path().parent().expect("tempdir has a parent");
        let err = validate_watch_path(parent, home.path()).unwrap_err();
        assert!(err.contains("too broad"), "got: {}", err);
    }

    #[test]
    fn validate_watch_path_accepts_sibling_of_home() {
        // Two distinct tempdirs with the same parent — sibling, not ancestor.
        let home = tempfile::tempdir().unwrap();
        let sibling = tempfile::tempdir().unwrap();
        let result = validate_watch_path(sibling.path(), home.path());
        assert!(result.is_ok(), "got: {:?}", result);
    }

    #[test]
    fn validate_watch_path_accepts_nested_project_under_home() {
        let home = tempfile::tempdir().unwrap();
        let nested = home.path().join("projects").join("repo-a");
        fs::create_dir_all(&nested).unwrap();
        let result = validate_watch_path(&nested, home.path());
        assert!(result.is_ok(), "got: {:?}", result);
    }

    #[test]
    fn validate_watch_path_rejects_symlinked_home_via_canonical() {
        // Create a real home dir, then a symlink pointing at it. Pass the
        // canonical (real) home as the home arg and the symlink as the path —
        // canonicalization should resolve them to the same path and reject.
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let real_home = tempfile::tempdir().unwrap();
            let link_parent = tempfile::tempdir().unwrap();
            let link_path = link_parent.path().join("home-link");
            symlink(real_home.path(), &link_path).unwrap();

            // canonical-home arg, raw-symlink as path → reject.
            let err = validate_watch_path(&link_path, real_home.path()).unwrap_err();
            assert!(err.contains("too broad"), "got: {}", err);

            // raw-symlink as home arg, raw-symlink as path → reject (canonicalize both).
            let err = validate_watch_path(&link_path, &link_path).unwrap_err();
            assert!(err.contains("too broad"), "got: {}", err);
        }
    }
}
