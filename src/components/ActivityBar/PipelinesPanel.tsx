import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PipelineInfo } from "../../types/reggie";

interface PipelinesPanelProps {
  onExecutePipeline: (pipelineName: string) => void;
  onEditPipeline: (filePath: string) => void;
}

function formatPipelineName(name: string): string {
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PipelinesPanel({ onExecutePipeline, onEditPipeline }: PipelinesPanelProps) {
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

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
            onExecute={onExecutePipeline}
            onEdit={onEditPipeline}
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
  onExecute: (pipelineName: string) => void;
  onEdit: (filePath: string) => void;
}

function PipelineCard({ pipeline, onExecute, onEdit }: PipelineCardProps) {
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

  return (
    <div className="pipeline-card">
      <div className="pipeline-card-header">
        <div className="pipeline-card-title">
          <span className="pipeline-name">{formatPipelineName(pipeline.name)}</span>
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
    </div>
  );
}
