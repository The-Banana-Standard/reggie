import { useCallback } from "react";
import type { TaskItem } from "../../types/task";

interface TaskCardProps {
  task: TaskItem;
  onStart: (slug: string) => void;
  interactive: boolean;
}

export function TaskCard({
  task,
  onStart,
  interactive,
}: TaskCardProps) {
  const handleStart = useCallback(() => {
    onStart(task.slug);
  }, [onStart, task.slug]);

  return (
    <div className={`task-card ${task.checked ? "task-card-done" : ""}`}>
      <div className="task-card-header">
        <span className="task-card-slug">{task.slug}</span>
        <div className="task-card-badges">
          {task.priority && (
            <span className={`task-badge task-badge-priority task-badge-${task.priority.toLowerCase()}`}>
              {task.priority}
            </span>
          )}
          {task.complexity && (
            <span className={`task-badge task-badge-complexity task-badge-${task.complexity}`}>
              {task.complexity}
            </span>
          )}
          {task.pipeline && (
            <span className="task-badge task-badge-pipeline">
              {task.pipeline}
            </span>
          )}
          {task.planned && (
            <span className="task-badge task-badge-planned">planned</span>
          )}
        </div>
        {interactive && !task.checked && (
          <button
            className="task-start-btn"
            onClick={handleStart}
            title={`Start ${task.slug}`}
          >
            Start
          </button>
        )}
      </div>
      <div className="task-card-description">{task.description}</div>
      {(task.depends.length > 0 || task.conflicts.length > 0) && (
        <div className="task-card-relations">
          {task.depends.length > 0 && (
            <span className="task-relation task-relation-depends">
              depends: {task.depends.join(", ")}
            </span>
          )}
          {task.conflicts.length > 0 && (
            <span className="task-relation task-relation-conflicts">
              conflicts: {task.conflicts.join(", ")}
            </span>
          )}
        </div>
      )}
      {task.filesLine && (
        <div className="task-card-files">
          {task.filesLine}
        </div>
      )}
    </div>
  );
}
