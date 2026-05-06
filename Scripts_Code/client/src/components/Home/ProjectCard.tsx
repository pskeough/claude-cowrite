import type { Project, TaskStatus } from '../../types';

interface Props {
  project: Project;
  onOpen: (project: Project) => void;
}

const TASK_LABELS: Record<string, string> = {
  splitChapters:    'Chapters',
  plotAnalysis:     'Plot',
  characterProfiles: 'Characters',
  voiceContext:     'Voice',
};

function StatusBadge({ label, status }: { label: string; status: TaskStatus }) {
  if (status === 'none') return null;
  return (
    <span className={`status-badge status-badge-${status}`}>
      {label}{status === 'running' ? ' …' : status === 'done' ? ' ✓' : status === 'error' ? ' ✗' : ''}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export default function ProjectCard({ project, onOpen }: Props) {
  const { status } = project;
  const hasAnyStatus =
    status.plotAnalysis !== 'none' ||
    status.characterProfiles !== 'none' ||
    status.voiceContext !== 'none' ||
    status.splitChapters !== 'none';

  return (
    <div className="project-card" onClick={() => onOpen(project)}>
      <div className="project-card-header">
        <span className="project-card-name">{project.bookTitle || project.name}</span>
        {project.id === 'builtin' && (
          <span className="project-card-builtin-badge">Legacy</span>
        )}
      </div>

      {project.description && (
        <p className="project-card-desc">{project.description}</p>
      )}

      {hasAnyStatus && (
        <div className="project-card-status">
          <StatusBadge label={TASK_LABELS.splitChapters} status={status.splitChapters} />
          <StatusBadge label={TASK_LABELS.plotAnalysis} status={status.plotAnalysis} />
          <StatusBadge label={TASK_LABELS.characterProfiles} status={status.characterProfiles} />
          <StatusBadge label={TASK_LABELS.voiceContext} status={status.voiceContext} />
        </div>
      )}

      <div className="project-card-meta">
        {project.author && <span>{project.author} · </span>}
        Created {formatDate(project.created)}
      </div>

      <button
        className="project-card-open-btn"
        onClick={(e) => { e.stopPropagation(); onOpen(project); }}
      >
        Open →
      </button>
    </div>
  );
}
