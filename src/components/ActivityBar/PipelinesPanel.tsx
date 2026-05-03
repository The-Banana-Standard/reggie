import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PipelineInfo } from "../../types/reggie";
import {
  usePipelineBindings,
  setBinding,
  clearBinding,
  type BindingMode,
  type PipelineBindings,
} from "../../lib/pipelineBindings";

interface PipelinesPanelProps {
  onExecutePipeline: (pipelineName: string) => void;
  onEditPipeline: (filePath: string) => void;
}

const BINDABLE_MODES: ReadonlyArray<{ mode: BindingMode; label: string }> = [
  { mode: "code", label: "Code" },
  { mode: "debug", label: "Debug" },
  { mode: "manual", label: "Manual" },
];

function formatPipelineName(name: string): string {
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Modes whose bound pipeline name does not appear in the loaded pipeline list. */
function findMissingBoundPipelines(
  bindings: PipelineBindings,
  pipelines: PipelineInfo[],
): Array<{ mode: BindingMode; pipelineName: string }> {
  const known = new Set(pipelines.map((p) => p.name));
  const missing: Array<{ mode: BindingMode; pipelineName: string }> = [];
  for (const { mode } of BINDABLE_MODES) {
    const bound = bindings[mode];
    if (bound && !known.has(bound)) {
      missing.push({ mode, pipelineName: bound });
    }
  }
  return missing;
}

export function PipelinesPanel({ onExecutePipeline, onEditPipeline }: PipelinesPanelProps) {
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const bindings = usePipelineBindings();

  const loadPipelines = useCallback(() => {
    setLoading(true);
    invoke<PipelineInfo[]>("get_pipelines")
      .then((result) => {
        setPipelines(result);
        setLoading(false);
      })
      .catch(() => {
        setPipelines([]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
  }, []);

  const handleBind = useCallback(
    (mode: BindingMode, pipelineName: string) => {
      // Toggle off if already bound to this pipeline; otherwise bind to it.
      if (bindings[mode] === pipelineName) {
        clearBinding(mode).catch((err) => console.error("Failed to clear binding:", err));
      } else {
        setBinding(mode, pipelineName).catch((err) => console.error("Failed to set binding:", err));
      }
    },
    [bindings],
  );

  const filtered = useMemo(
    () =>
      filter
        ? pipelines.filter(
            (p) =>
              p.name.toLowerCase().includes(filter.toLowerCase()) ||
              p.description.toLowerCase().includes(filter.toLowerCase())
          )
        : pipelines,
    [pipelines, filter]
  );

  const missingBound = useMemo(
    () => findMissingBoundPipelines(bindings, pipelines),
    [bindings, pipelines],
  );

  if (loading) {
    return (
      <div className="pipelines-panel">
        <h3 className="pipelines-panel-title">Pipelines</h3>
        <div className="pipelines-empty">Loading pipelines...</div>
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <div className="pipelines-panel">
        <h3 className="pipelines-panel-title">Pipelines</h3>
        <div className="pipelines-empty">
          No pipeline commands found in ~/.claude/commands/
        </div>
      </div>
    );
  }

  return (
    <div className="pipelines-panel">
      <h3 className="pipelines-panel-title">Pipelines ({pipelines.length})</h3>

      {missingBound.length > 0 && (
        <div className="pipelines-binding-warnings" role="alert">
          {missingBound.map(({ mode, pipelineName }) => (
            <div key={mode} className="pipelines-binding-warning">
              Bound pipeline '{pipelineName}' not found, using default
            </div>
          ))}
        </div>
      )}

      <input
        className="pipelines-search"
        type="text"
        placeholder="Filter pipelines..."
        value={filter}
        onChange={handleFilterChange}
      />

      <div className="pipelines-group">
        {filtered.map((pipeline) => (
          <PipelineCard
            key={pipeline.name}
            pipeline={pipeline}
            bindings={bindings}
            onExecute={onExecutePipeline}
            onEdit={onEditPipeline}
            onBind={handleBind}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="pipelines-empty">No pipelines found</div>
      )}
    </div>
  );
}

interface PipelineCardProps {
  pipeline: PipelineInfo;
  bindings: PipelineBindings;
  onExecute: (pipelineName: string) => void;
  onEdit: (filePath: string) => void;
  onBind: (mode: BindingMode, pipelineName: string) => void;
}

function PipelineCard({ pipeline, bindings, onExecute, onEdit, onBind }: PipelineCardProps) {
  const handleExecuteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onExecute(pipeline.name);
    },
    [onExecute, pipeline.name]
  );

  const handleEditCommandClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEdit(pipeline.commandFilePath);
    },
    [onEdit, pipeline.commandFilePath]
  );

  const handleEditManagerClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (pipeline.managerFilePath) {
        onEdit(pipeline.managerFilePath);
      }
    },
    [onEdit, pipeline.managerFilePath]
  );

  // Modes this pipeline is currently the default for.
  const boundModes = BINDABLE_MODES.filter(({ mode }) => bindings[mode] === pipeline.name);

  return (
    <div className="pipeline-card">
      <div className="pipeline-card-header">
        <div className="pipeline-card-title">
          <span className="pipeline-name">{formatPipelineName(pipeline.name)}</span>
          {boundModes.length > 0 && (
            <span className="pipeline-binding-badge" aria-label="Default for modes">
              Default: {boundModes.map((b) => b.label).join(", ")}
            </span>
          )}
        </div>
        <div className="pipeline-card-actions">
          <button
            className="pipeline-execute-btn"
            onClick={handleExecuteClick}
            title="Execute pipeline"
            aria-label={`Execute ${pipeline.name} pipeline`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
          <button
            className="pipeline-edit-btn"
            onClick={handleEditCommandClick}
            title="Edit command file"
            aria-label={`Edit ${pipeline.name} command file`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        </div>
      </div>

      {pipeline.description && (
        <div className="pipeline-desc">
          {pipeline.description}
        </div>
      )}

      {pipeline.managerName && (
        <div className="pipeline-manager-row">
          <span className="pipeline-manager-label">Manager:</span>
          <span className="pipeline-manager-name">{formatPipelineName(pipeline.managerName)}</span>
          <button
            className="pipeline-edit-btn"
            onClick={handleEditManagerClick}
            title="Edit manager agent file"
            aria-label={`Edit ${pipeline.managerName} agent file`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        </div>
      )}

      <div className="pipeline-bind-row">
        <span className="pipeline-bind-label">Bind to:</span>
        {BINDABLE_MODES.map(({ mode, label }) => {
          const isActive = bindings[mode] === pipeline.name;
          return (
            <button
              key={mode}
              type="button"
              className={`pipeline-bind-btn${isActive ? " pipeline-bind-btn-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onBind(mode, pipeline.name);
              }}
              title={
                isActive
                  ? `Clear ${label} binding (revert to default)`
                  : `Bind ${label} mode to ${pipeline.name}`
              }
              aria-pressed={isActive}
              aria-label={`Bind ${pipeline.name} to ${label} mode`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
