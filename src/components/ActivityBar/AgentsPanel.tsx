import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "../../types/reggie";

interface AgentsPanelProps {
  onEditAgent: (filePath: string) => void;
}

function formatAgentName(name: string): string {
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getModelBadgeClass(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return "agent-model-badge opus";
  if (lower.includes("haiku")) return "agent-model-badge haiku";
  return "agent-model-badge sonnet";
}

export function AgentsPanel({ onEditAgent }: AgentsPanelProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const loadAgents = useCallback(() => {
    setLoading(true);
    invoke<AgentInfo[]>("get_agents")
      .then((result) => {
        setAgents(result);
        setLoading(false);
      })
      .catch(() => {
        setAgents([]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const toggleExpand = useCallback((name: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
  }, []);

  const filtered = useMemo(
    () =>
      filter
        ? agents.filter(
            (a) =>
              a.name.toLowerCase().includes(filter.toLowerCase()) ||
              a.description.toLowerCase().includes(filter.toLowerCase())
          )
        : agents,
    [agents, filter]
  );

  if (loading) {
    return (
      <div className="agents-panel">
        <h3 className="agents-panel-title">Agents</h3>
        <div className="agents-empty">Loading agents...</div>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="agents-panel">
        <h3 className="agents-panel-title">Agents</h3>
        <div className="agents-empty">
          Install Reggie to see agents
        </div>
      </div>
    );
  }

  return (
    <div className="agents-panel">
      <h3 className="agents-panel-title">Agents ({agents.length})</h3>

      <input
        className="agents-search"
        type="text"
        placeholder="Filter agents..."
        value={filter}
        onChange={handleFilterChange}
      />

      <div className="agents-group">
        {filtered.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            expanded={expandedAgents.has(agent.name)}
            onToggleExpand={toggleExpand}
            onEdit={onEditAgent}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="agents-empty">No agents found</div>
      )}
    </div>
  );
}

interface AgentCardProps {
  agent: AgentInfo;
  expanded: boolean;
  onToggleExpand: (name: string) => void;
  onEdit: (filePath: string) => void;
}

function AgentCard({ agent, expanded, onToggleExpand, onEdit }: AgentCardProps) {
  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEdit(agent.filePath);
    },
    [onEdit, agent.filePath]
  );

  const handleCardClick = useCallback(() => {
    onToggleExpand(agent.name);
  }, [onToggleExpand, agent.name]);

  return (
    <div className="agent-card" onClick={handleCardClick}>
      <div className="agent-card-header">
        <div className="agent-card-title">
          <span className="agent-name">{formatAgentName(agent.name)}</span>
          {agent.model && (
            <span className={getModelBadgeClass(agent.model)}>
              {agent.model}
            </span>
          )}
        </div>
        <button
          className="agent-edit-btn"
          onClick={handleEditClick}
          title="Edit agent file"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
        </button>
      </div>

      <div className={expanded ? "agent-desc expanded" : "agent-desc"}>
        {agent.description}
      </div>

      {expanded && agent.tools.length > 0 && (
        <div className="agent-tools">
          {agent.tools.map((tool) => (
            <span key={tool} className="agent-tool-pill">{tool}</span>
          ))}
        </div>
      )}
    </div>
  );
}
