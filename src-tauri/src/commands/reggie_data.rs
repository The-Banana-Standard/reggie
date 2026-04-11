use serde::Serialize;
use std::fs;
use std::path::PathBuf;

use super::frontmatter::{split_frontmatter, strip_quotes};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub name: String,
    pub description: String,
    pub model: Option<String>,
    pub tools: Vec<String>,
    pub memory: Option<String>,
    pub file_path: String,
    pub is_pipeline_manager: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandInfo {
    pub name: String,
    pub description: String,
    pub command_type: String,
    pub source: String,
    pub file_path: String,
    pub manager: Option<String>,
}

/// Parses a command markdown file into a `CommandInfo`.
///
/// Commands may or may not have YAML frontmatter. If frontmatter exists,
/// `type` is extracted from it (defaulting to "utility"). If no frontmatter,
/// the name comes from the filename stem and the description from the first
/// non-empty line after the `# Heading`. The `source` parameter indicates
/// where the command was found ("global" or "project").
fn parse_command_file(path: &PathBuf, source: &str) -> Option<CommandInfo> {
    let content = fs::read_to_string(path).ok()?;

    let name = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut command_type = "utility".to_string();
    let mut manager: Option<String> = None;

    // If frontmatter exists, try to extract type and manager from it
    if let Some(frontmatter) = split_frontmatter(&content).0 {
        for line in frontmatter.lines() {
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim();
                let value = value.trim();
                if value.is_empty() {
                    continue;
                }
                if key == "type" {
                    command_type = strip_quotes(value).to_string();
                }
                if key == "manager" {
                    manager = Some(strip_quotes(value).to_string());
                }
            }
        }
    }

    // Extract description: first non-empty line after the # heading,
    // stopping before any ## section
    let mut description = String::new();
    let mut found_heading = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if !found_heading {
            if trimmed.starts_with("# ") && !trimmed.starts_with("## ") {
                found_heading = true;
            }
            continue;
        }
        // Stop at the next section heading
        if trimmed.starts_with("## ") {
            break;
        }
        // Skip empty lines between heading and description
        if trimmed.is_empty() {
            continue;
        }
        description = trimmed.to_string();
        break;
    }

    Some(CommandInfo {
        name,
        description,
        command_type,
        source: source.to_string(),
        file_path: path.to_string_lossy().to_string(),
        manager,
    })
}

/// Returns metadata for all command files in `~/.claude/commands/` and optionally
/// `{project}/.claude/commands/`.
///
/// Commands with `type: pipeline` are filtered out. Results are sorted
/// alphabetically by name. Returns an empty vec if no commands directories exist.
#[tauri::command]
pub fn get_commands(project_path: Option<String>) -> Result<Vec<CommandInfo>, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    let mut commands: Vec<CommandInfo> = Vec::new();

    // Global commands from ~/.claude/commands/
    let global_dir = home.join(".claude").join("commands");
    if global_dir.is_dir() {
        let entries = fs::read_dir(&global_dir)
            .map_err(|e| format!("Failed to read commands directory: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if let Some(command) = parse_command_file(&path, "global") {
                if command.command_type != "pipeline" {
                    commands.push(command);
                }
            }
        }
    }

    // Project-level commands from {project}/.claude/commands/
    if let Some(ref proj) = project_path {
        let proj_dir = PathBuf::from(proj).join(".claude").join("commands");
        if proj_dir.is_dir() {
            let entries = fs::read_dir(&proj_dir)
                .map_err(|e| format!("Failed to read project commands directory: {e}"))?;

            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                if let Some(command) = parse_command_file(&path, "project") {
                    if command.command_type != "pipeline" {
                        commands.push(command);
                    }
                }
            }
        }
    }

    commands.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(commands)
}

/// Parses an agent markdown file into an `AgentInfo`.
///
/// Returns `None` if the file cannot be read or has no valid frontmatter.
fn parse_agent_file(path: &PathBuf) -> Option<AgentInfo> {
    let content = fs::read_to_string(path).ok()?;
    let frontmatter = split_frontmatter(&content).0?;

    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut model: Option<String> = None;
    let mut tools_raw: Option<String> = None;
    let mut memory: Option<String> = None;

    for line in frontmatter.lines() {
        // Match lines of the form `key: value`
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim();
            if value.is_empty() {
                continue;
            }
            match key {
                "name" => name = Some(strip_quotes(value).to_string()),
                "description" => description = Some(strip_quotes(value).to_string()),
                "model" => model = Some(strip_quotes(value).to_string()),
                "tools" => tools_raw = Some(strip_quotes(value).to_string()),
                "memory" => memory = Some(strip_quotes(value).to_string()),
                _ => {}
            }
        }
    }

    // Fall back to filename stem if name not in frontmatter
    let name = name.unwrap_or_else(|| {
        path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
    });

    let description = description.unwrap_or_default();

    let tools: Vec<String> = tools_raw
        .map(|raw| {
            raw.split(',')
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let is_pipeline_manager = description.contains("REFERENCE DOCUMENT for the main Claude orchestrator");

    Some(AgentInfo {
        name,
        description,
        model,
        tools,
        memory,
        file_path: path.to_string_lossy().to_string(),
        is_pipeline_manager,
    })
}

/// Returns metadata for all agent files in `~/.claude/agents/`.
///
/// Pipeline managers (descriptions containing "REFERENCE DOCUMENT for the main Claude
/// orchestrator") are filtered out. Results are sorted alphabetically by name.
/// Returns an empty vec if the agents directory does not exist.
#[tauri::command]
pub fn get_agents() -> Result<Vec<AgentInfo>, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    let agents_dir = home.join(".claude").join("agents");
    if !agents_dir.is_dir() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&agents_dir)
        .map_err(|e| format!("Failed to read agents directory: {e}"))?;

    let mut agents: Vec<AgentInfo> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                return None;
            }
            let agent = parse_agent_file(&path)?;
            // Filter out pipeline managers
            if agent.is_pipeline_manager {
                return None;
            }
            Some(agent)
        })
        .collect();

    agents.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(agents)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineInfo {
    pub name: String,
    pub description: String,
    pub command_file_path: String,
    pub manager_name: Option<String>,
    pub manager_file_path: Option<String>,
}

/// Returns metadata for all pipeline commands paired with their pipeline manager agents.
///
/// Pipeline commands have `type: pipeline` in their frontmatter. Pipeline managers
/// are agents whose description contains "REFERENCE DOCUMENT for the main Claude
/// orchestrator". Each command is matched to its manager via the `manager:` field
/// in its frontmatter. Results are sorted alphabetically by command name.
#[tauri::command]
pub fn get_pipelines() -> Result<Vec<PipelineInfo>, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    // Collect pipeline commands
    let commands_dir = home.join(".claude").join("commands");
    let mut pipeline_commands: Vec<CommandInfo> = Vec::new();

    if commands_dir.is_dir() {
        let entries = fs::read_dir(&commands_dir)
            .map_err(|e| format!("Failed to read commands directory: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if let Some(command) = parse_command_file(&path, "global") {
                if command.command_type == "pipeline" {
                    pipeline_commands.push(command);
                }
            }
        }
    }

    // Collect pipeline managers
    let agents_dir = home.join(".claude").join("agents");
    let mut managers: Vec<AgentInfo> = Vec::new();

    if agents_dir.is_dir() {
        let entries = fs::read_dir(&agents_dir)
            .map_err(|e| format!("Failed to read agents directory: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if let Some(agent) = parse_agent_file(&path) {
                if agent.is_pipeline_manager {
                    managers.push(agent);
                }
            }
        }
    }

    // Pair commands with managers via frontmatter `manager:` field
    let mut pipelines: Vec<PipelineInfo> = pipeline_commands
        .into_iter()
        .map(|cmd| {
            let matched = cmd.manager.as_ref().and_then(|mgr_name| {
                managers.iter().find(|m| &m.name == mgr_name)
            });
            PipelineInfo {
                name: cmd.name,
                description: cmd.description,
                command_file_path: cmd.file_path,
                manager_name: matched.map(|m| m.name.clone()),
                manager_file_path: matched.map(|m| m.file_path.clone()),
            }
        })
        .collect();

    pipelines.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(pipelines)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_agent_file_full() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("code-reviewer.md");
        std::fs::write(
            &file_path,
            "---\nname: code-reviewer\ndescription: \"Reviews code for bugs\"\ntools: Glob, Grep, Read\nmodel: opus\nmemory: project\n---\n\n## Role\nReview code.\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path));
        assert!(agent.is_some());

        let agent = agent.unwrap();
        assert_eq!(agent.name, "code-reviewer");
        assert_eq!(agent.description, "Reviews code for bugs");
        assert_eq!(agent.model, Some("opus".to_string()));
        assert_eq!(agent.tools, vec!["Glob", "Grep", "Read"]);
        assert_eq!(agent.memory, Some("project".to_string()));
        assert_eq!(agent.file_path, file_path.to_string_lossy().to_string());
        assert!(!agent.is_pipeline_manager);
    }

    #[test]
    fn parse_agent_file_name_fallback_to_filename() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("my-agent.md");
        std::fs::write(
            &file_path,
            "---\ndescription: \"A simple agent\"\n---\n\n## Role\nDo things.\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        assert_eq!(agent.name, "my-agent");
    }

    #[test]
    fn parse_agent_file_missing_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("no-frontmatter.md");
        std::fs::write(&file_path, "# Just a heading\nSome content.\n").unwrap();

        assert!(parse_agent_file(&PathBuf::from(&file_path)).is_none());
    }

    #[test]
    fn parse_agent_file_empty_tools() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("no-tools.md");
        std::fs::write(
            &file_path,
            "---\nname: minimal\ndescription: \"Minimal agent\"\n---\n\n## Role\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        assert!(agent.tools.is_empty());
    }

    #[test]
    fn parse_agent_file_pipeline_manager() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("pm.md");
        std::fs::write(
            &file_path,
            "---\nname: audit-pm\ndescription: \"This is a REFERENCE DOCUMENT for the main Claude orchestrator\"\n---\n\n## Role\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        assert!(agent.is_pipeline_manager);
    }

    #[test]
    fn get_agents_filters_pipeline_managers() {
        let dir = tempfile::tempdir().unwrap();
        let agents_dir = dir.path().join(".claude").join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();

        // Regular agent
        std::fs::write(
            agents_dir.join("worker.md"),
            "---\nname: worker\ndescription: \"Does work\"\n---\n\n## Role\n",
        )
        .unwrap();

        // Pipeline manager — should be filtered out
        std::fs::write(
            agents_dir.join("pm.md"),
            "---\nname: pm\ndescription: \"REFERENCE DOCUMENT for the main Claude orchestrator\"\n---\n\n## Role\n",
        )
        .unwrap();

        // We can't easily test get_agents() directly because it uses dirs::home_dir(),
        // but we can verify parse_agent_file + filtering logic independently.
        let worker = parse_agent_file(&agents_dir.join("worker.md")).unwrap();
        let pm = parse_agent_file(&agents_dir.join("pm.md")).unwrap();

        assert!(!worker.is_pipeline_manager);
        assert!(pm.is_pipeline_manager);
    }

    #[test]
    fn parse_agent_file_unquoted_description() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("unquoted.md");
        std::fs::write(
            &file_path,
            "---\nname: unquoted\ndescription: A plain description without quotes\n---\n\n## Role\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        assert_eq!(agent.description, "A plain description without quotes");
    }

    #[test]
    fn parse_agent_file_description_with_colon() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("colon-desc.md");
        std::fs::write(
            &file_path,
            "---\nname: reviewer\ndescription: \"Reviews code: finds bugs and edge cases\"\n---\n\n## Role\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        assert_eq!(agent.description, "Reviews code: finds bugs and edge cases");
    }

    #[test]
    fn parse_agent_file_unquoted_description_with_colon() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("colon-unquoted.md");
        std::fs::write(
            &file_path,
            "---\nname: reviewer\ndescription: Reviews code: finds bugs\n---\n\n## Role\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        // split_once on ':' should preserve everything after the first colon
        assert_eq!(agent.description, "Reviews code: finds bugs");
    }

    #[test]
    fn parse_agent_file_empty_description_line_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("empty-desc.md");
        std::fs::write(
            &file_path,
            "---\nname: empty-desc\ndescription:\nmodel: opus\n---\n\n## Role\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        // Empty value after colon is skipped, so description defaults to ""
        assert_eq!(agent.description, "");
    }

    #[test]
    fn parse_agent_file_nonexistent_file() {
        let path = PathBuf::from("/nonexistent/path/agent.md");
        assert!(parse_agent_file(&path).is_none());
    }

    #[test]
    fn parse_agent_file_tools_with_extra_whitespace() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("spaced-tools.md");
        std::fs::write(
            &file_path,
            "---\nname: spaced\ndescription: test\ntools:  Glob ,  Grep , Read \n---\n\n## Role\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        assert_eq!(agent.tools, vec!["Glob", "Grep", "Read"]);
    }

    #[test]
    fn parse_agent_file_single_tool() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("single-tool.md");
        std::fs::write(
            &file_path,
            "---\nname: single\ndescription: test\ntools: Bash\n---\n\n## Role\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        assert_eq!(agent.tools, vec!["Bash"]);
    }

    #[test]
    fn is_pipeline_manager_flag_consistent_with_filter() {
        // An agent with "REFERENCE DOCUMENT" but NOT the full phrase
        // should NOT be marked as a pipeline manager
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("partial-pm.md");
        std::fs::write(
            &file_path,
            "---\nname: partial-pm\ndescription: \"This is a REFERENCE DOCUMENT for other purposes\"\n---\n\n## Role\n",
        )
        .unwrap();

        let agent = parse_agent_file(&PathBuf::from(&file_path)).unwrap();
        // Both the flag and the filter use the same long string
        assert!(!agent.is_pipeline_manager);
        assert!(!agent.description.contains("REFERENCE DOCUMENT for the main Claude orchestrator"));
    }

    // ── Command parsing tests ──

    #[test]
    fn parse_command_file_no_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("code-workflow.md");
        std::fs::write(
            &file_path,
            "# Code Workflow\n\nExecute the complete development workflow.\n\n## Context\nSome context.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.name, "code-workflow");
        assert_eq!(cmd.description, "Execute the complete development workflow.");
        assert_eq!(cmd.command_type, "utility");
        assert_eq!(cmd.source, "global");
        assert_eq!(cmd.file_path, file_path.to_string_lossy().to_string());
        assert_eq!(cmd.manager, None);
    }

    #[test]
    fn parse_command_file_with_frontmatter_type() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("deploy.md");
        std::fs::write(
            &file_path,
            "---\ntype: stage\n---\n# Deploy\n\nDeploy the app.\n\n## Steps\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.name, "deploy");
        assert_eq!(cmd.description, "Deploy the app.");
        assert_eq!(cmd.command_type, "stage");
        assert_eq!(cmd.source, "global");
        assert_eq!(cmd.manager, None);
    }

    #[test]
    fn parse_command_file_pipeline_type() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("build-pipeline.md");
        std::fs::write(
            &file_path,
            "---\ntype: pipeline\n---\n# Build Pipeline\n\nOrchestrates builds.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.command_type, "pipeline");
        assert_eq!(cmd.manager, None);
    }

    #[test]
    fn parse_command_file_empty_description() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("empty.md");
        std::fs::write(
            &file_path,
            "# Empty Command\n\n## Context\nJumps straight to context.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.name, "empty");
        assert_eq!(cmd.description, "");
        assert_eq!(cmd.manager, None);
    }

    #[test]
    fn parse_command_file_no_heading() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("bare.md");
        std::fs::write(
            &file_path,
            "Just some text without a heading.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.name, "bare");
        assert_eq!(cmd.description, "");
        assert_eq!(cmd.manager, None);
    }

    #[test]
    fn parse_command_file_nonexistent() {
        let path = PathBuf::from("/nonexistent/path/command.md");
        assert!(parse_command_file(&path, "global").is_none());
    }

    #[test]
    fn parse_command_file_description_on_next_line() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("brainstorm.md");
        std::fs::write(
            &file_path,
            "# Brainstorm\n\nUse the thought-partner agent as a thinking partner.\n\n## Instructions\nDo stuff.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.description, "Use the thought-partner agent as a thinking partner.");
        assert_eq!(cmd.manager, None);
    }

    #[test]
    fn parse_command_file_project_source() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("lint-fix.md");
        std::fs::write(
            &file_path,
            "# Lint Fix\n\nRun the linter and auto-fix issues.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "project").unwrap();
        assert_eq!(cmd.name, "lint-fix");
        assert_eq!(cmd.description, "Run the linter and auto-fix issues.");
        assert_eq!(cmd.command_type, "utility");
        assert_eq!(cmd.source, "project");
        assert_eq!(cmd.file_path, file_path.to_string_lossy().to_string());
        assert_eq!(cmd.manager, None);
    }

    #[test]
    fn parse_command_file_source_passthrough_arbitrary() {
        // Verify that the source parameter is stored as-is, regardless of value
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test-cmd.md");
        std::fs::write(&file_path, "# Test\n\nA test command.\n").unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "workspace").unwrap();
        assert_eq!(cmd.source, "workspace");
        assert_eq!(cmd.manager, None);
    }

    // ── Manager frontmatter tests ──

    #[test]
    fn parse_command_file_with_manager_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("code-pipeline.md");
        std::fs::write(
            &file_path,
            "---\ntype: pipeline\nmanager: reggie-code-manager\n---\n# Code Pipeline\n\nRuns the code pipeline.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.command_type, "pipeline");
        assert_eq!(cmd.manager, Some("reggie-code-manager".to_string()));
    }

    #[test]
    fn parse_command_file_with_manager_and_type() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("audit.md");
        std::fs::write(
            &file_path,
            "---\ntype: stage\nmanager: reggie-audit-manager\n---\n# Audit\n\nRun audit checks.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.command_type, "stage");
        assert_eq!(cmd.manager, Some("reggie-audit-manager".to_string()));
    }

    #[test]
    fn parse_command_file_manager_without_type() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("orphan.md");
        std::fs::write(
            &file_path,
            "---\nmanager: reggie-orphan-manager\n---\n# Orphan\n\nCommand with manager but no type.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.command_type, "utility");
        assert_eq!(cmd.manager, Some("reggie-orphan-manager".to_string()));
    }

    #[test]
    fn parse_command_file_manager_quoted() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("quoted-mgr.md");
        std::fs::write(
            &file_path,
            "---\ntype: pipeline\nmanager: \"reggie-audit-manager\"\n---\n# Quoted\n\nManager value has quotes.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.manager, Some("reggie-audit-manager".to_string()));
    }

    #[test]
    fn parse_command_file_manager_empty_value() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("empty-mgr.md");
        std::fs::write(
            &file_path,
            "---\ntype: pipeline\nmanager:\n---\n# Empty Manager\n\nManager field is empty.\n",
        )
        .unwrap();

        let cmd = parse_command_file(&PathBuf::from(&file_path), "global").unwrap();
        assert_eq!(cmd.command_type, "pipeline");
        assert_eq!(cmd.manager, None);
    }

}
