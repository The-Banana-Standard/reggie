import { useMemo } from "react";
import { parseTasksMd } from "../../types/task";
import type { TaskPipeline } from "../../types/task";
import { TaskCard } from "./TaskCard";

interface TasksViewerProps {
  tasksMd: string;
  onStartTask: (slug: string, mode: TaskPipeline | null) => void;
}

export function TasksViewer({ tasksMd, onStartTask }: TasksViewerProps) {
  const parsed = useMemo(() => parseTasksMd(tasksMd), [tasksMd]);

  const hasGroomed = parsed.groomed.some((s) => s.tasks.length > 0);
  const hasUngroomed = parsed.ungroomed.length > 0;
  const hasLaterFeatures = parsed.laterFeatures.length > 0;
  const hasActive = parsed.active.length > 0;

  if (!hasGroomed && !hasUngroomed && !hasLaterFeatures && !hasActive) {
    return null;
  }

  return (
    <div className="tasks-viewer">
      {/* Active tasks */}
      {hasActive && (
        <div className="tasks-section tasks-section-active">
          <h5 className="tasks-section-title">Active Tasks</h5>
          <div className="tasks-section-cards">
            {parsed.active.map((task) => (
              <TaskCard
                key={task.slug}
                task={task}
                onStart={onStartTask}
                interactive={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Groomed tasks -- grouped by section, with Start button */}
      {hasGroomed && (
        <div className="tasks-section tasks-section-groomed">
          <h5 className="tasks-section-title tasks-section-title-groomed">Groomed</h5>
          {parsed.groomed.map((section) => (
            <div key={section.title} className="tasks-subsection">
              <h6 className="tasks-subsection-title">{section.title}</h6>
              <div className="tasks-section-cards">
                {section.tasks.map((task) => (
                  <TaskCard
                    key={task.slug}
                    task={task}
                    onStart={onStartTask}
                    interactive={true}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ungroomed tasks -- flat list, no Start */}
      {hasUngroomed && (
        <div className="tasks-section tasks-section-ungroomed">
          <h5 className="tasks-section-title tasks-section-title-ungroomed">Ungroomed</h5>
          <div className="tasks-section-cards">
            {parsed.ungroomed.map((task) => (
              <TaskCard
                key={task.slug}
                task={task}
                onStart={onStartTask}
                interactive={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Later Features -- flat list, no Start */}
      {hasLaterFeatures && (
        <div className="tasks-section tasks-section-later">
          <h5 className="tasks-section-title tasks-section-title-later">Later Features</h5>
          <div className="tasks-section-cards">
            {parsed.laterFeatures.map((task) => (
              <TaskCard
                key={task.slug}
                task={task}
                onStart={onStartTask}
                interactive={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
