import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandInfo } from "../../types/reggie";

interface CommandsPanelProps {
  projectPath: string | null;
  onExecuteCommand: (commandName: string) => void;
  onEditCommand: (filePath: string) => void;
}

function formatCommandName(name: string): string {
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getTypeBadgeClass(commandType: string): string {
  const lower = commandType.toLowerCase();
  if (lower === "stage") return "command-type-badge stage";
  return "command-type-badge utility";
}

export function CommandsPanel({ projectPath, onExecuteCommand, onEditCommand }: CommandsPanelProps) {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const loadCommands = useCallback(() => {
    setLoading(true);
    invoke<CommandInfo[]>("get_commands", { projectPath })
      .then((result) => {
        setCommands(result);
        setLoading(false);
      })
      .catch(() => {
        setCommands([]);
        setLoading(false);
      });
  }, [projectPath]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
  }, []);

  const filtered = useMemo(
    () =>
      filter
        ? commands.filter(
            (c) =>
              c.name.toLowerCase().includes(filter.toLowerCase()) ||
              c.description.toLowerCase().includes(filter.toLowerCase())
          )
        : commands,
    [commands, filter]
  );

  const projectCommands = useMemo(
    () => filtered.filter((c) => c.source === "project"),
    [filtered]
  );

  const globalCommands = useMemo(
    () => filtered.filter((c) => c.source === "global"),
    [filtered]
  );

  if (loading) {
    return (
      <div className="commands-panel">
        <h3 className="commands-panel-title">Commands</h3>
        <div className="commands-empty">Loading commands...</div>
      </div>
    );
  }

  if (commands.length === 0) {
    return (
      <div className="commands-panel">
        <h3 className="commands-panel-title">Commands</h3>
        <div className="commands-empty">
          No commands found in ~/.claude/commands/
        </div>
      </div>
    );
  }

  return (
    <div className="commands-panel">
      <h3 className="commands-panel-title">Commands ({commands.length})</h3>

      <input
        className="commands-search"
        type="text"
        placeholder="Filter commands..."
        value={filter}
        onChange={handleFilterChange}
      />

      {projectCommands.length > 0 && (
        <div className="commands-group">
          <div className="commands-group-label">Project</div>
          {projectCommands.map((command) => (
            <CommandCard
              key={`project-${command.name}`}
              command={command}
              onExecute={onExecuteCommand}
              onEdit={onEditCommand}
            />
          ))}
        </div>
      )}

      <div className="commands-group">
        <div className="commands-group-label">
          Global
          <span className="commands-count">{globalCommands.length}</span>
        </div>
        {globalCommands.map((command) => (
          <CommandCard
            key={`global-${command.name}`}
            command={command}
            onExecute={onExecuteCommand}
            onEdit={onEditCommand}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="commands-empty">No commands found</div>
      )}
    </div>
  );
}

interface CommandCardProps {
  command: CommandInfo;
  onExecute: (commandName: string) => void;
  onEdit: (filePath: string) => void;
}

function CommandCard({ command, onExecute, onEdit }: CommandCardProps) {
  const handleExecuteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onExecute(command.name);
    },
    [onExecute, command.name]
  );

  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEdit(command.filePath);
    },
    [onEdit, command.filePath]
  );

  return (
    <div className="command-card">
      <div className="command-card-header">
        <div className="command-card-title">
          <span className="command-name">{formatCommandName(command.name)}</span>
          <span className={getTypeBadgeClass(command.commandType)}>
            {command.commandType}
          </span>
        </div>
        <div className="command-card-actions">
          <button
            className="command-execute-btn"
            onClick={handleExecuteClick}
            title="Execute command"
            aria-label={`Execute ${command.name} command`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
          <button
            className="command-edit-btn"
            onClick={handleEditClick}
            title="Edit command file"
            aria-label={`Edit ${command.name} command file`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        </div>
      </div>

      {command.description && (
        <div className="command-desc">
          {command.description}
        </div>
      )}
    </div>
  );
}
