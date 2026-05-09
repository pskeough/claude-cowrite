import { useEffect, useState } from 'react';
import type { FileNode, Project, TaskStatus, JobProgress } from '../../types';
import { getProjectById, queueProjectAnalysis } from '../../api';

interface Props {
  project: Project;
  files: FileNode[];
  onSelectFile: (path: string) => void;
}

const STATUS_COPY: Record<TaskStatus, { label: string; cls: string }> = {
  none:    { label: 'Not run',  cls: 'status-pill--none'    },
  pending: { label: 'Pending',  cls: 'status-pill--pending' },
  running: { label: 'Running…', cls: 'status-pill--running' },
  done:    { label: 'Done',     cls: 'status-pill--done'    },
  error:   { label: 'Error',    cls: 'status-pill--error'   },
};

function findDir(nodes: FileNode[], name: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.type === 'directory' && n.name === name) return n;
    if (n.children) {
      const found = findDir(n.children, name);
      if (found) return found;
    }
  }
  return undefined;
}

function findChapterFiles(nodes: FileNode[]): FileNode[] {
  const chaptersDir = findDir(nodes, 'Chapters');
  if (!chaptersDir?.children) return [];
  const out: FileNode[] = [];
  const walk = (n: FileNode) => {
    if (n.type === 'file' && n.name.endsWith('.txt')) out.push(n);
    n.children?.forEach(walk);
  };
  chaptersDir.children.forEach(walk);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function findAnalysisFiles(nodes: FileNode[]): FileNode[] {
  const dir = findDir(nodes, 'AI_Analysis_Output');
  if (!dir?.children) return [];
  return dir.children.filter(n => n.type === 'file' && (n.name.endsWith('.md') || n.name.endsWith('.txt')));
}

export default function ProjectDashboard({ project, files, onSelectFile }: Props) {
  const [progress, setProgress] = useState<JobProgress | null | undefined>(project.progress);
  const [status, setStatus] = useState(project.status);
  const [rerunning, setRerunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Poll while anything is running
  useEffect(() => {
    const isRunning = (s: TaskStatus) => s === 'running' || s === 'pending';
    const anyRunning =
      isRunning(status.splitChapters) ||
      isRunning(status.plotAnalysis) ||
      isRunning(status.characterProfiles) ||
      isRunning(status.voiceContext);

    if (!anyRunning) return;

    const tick = async () => {
      try {
        const fresh = await getProjectById(project.id);
        setStatus(fresh.status);
        setProgress(fresh.progress);
      } catch { /* swallow */ }
    };
    const t = setInterval(tick, 2500);
    return () => clearInterval(t);
  }, [project.id, status]);

  const chapterFiles = findChapterFiles(files);
  const analysisFiles = findAnalysisFiles(files);

  async function handleRerun() {
    setRerunning(true);
    setErr(null);
    try {
      await queueProjectAnalysis(project.id, {
        plotAnalysis: true,
        characterProfiles: true,
        voiceContext: true,
        model: project.analysisConfig.model,
      });
      // Optimistically mark as pending so the poll loop kicks in
      setStatus(s => ({
        ...s,
        plotAnalysis: 'pending',
        characterProfiles: 'pending',
        voiceContext: 'pending',
      }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRerunning(false);
    }
  }

  const tasks: { key: keyof typeof status; label: string }[] = [
    { key: 'splitChapters',    label: 'Chapters split'      },
    { key: 'plotAnalysis',     label: 'Plot analysis'       },
    { key: 'characterProfiles', label: 'Character profiles' },
    { key: 'voiceContext',     label: 'Authorial voice'     },
  ];

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h2 className="dashboard-title">{project.bookTitle || project.name}</h2>
        {project.author && <div className="dashboard-author">by {project.author}</div>}
        {project.description && <p className="dashboard-desc">{project.description}</p>}
      </header>

      {progress && !progress.complete && (
        <div className="dashboard-progress">
          <div className="dashboard-progress-bar">
            <div
              className="dashboard-progress-fill"
              style={{ width: `${progress.tasksTotal ? (progress.tasksDone / progress.tasksTotal) * 100 : 0}%` }}
            />
          </div>
          <div className="dashboard-progress-label">
            {progress.currentTask} · {progress.tasksDone}/{progress.tasksTotal}
          </div>
        </div>
      )}

      <section className="dashboard-section">
        <div className="dashboard-section-title">Analysis</div>
        <div className="dashboard-tasks">
          {tasks.map(({ key, label }) => {
            const s = status[key];
            const copy = STATUS_COPY[s];
            return (
              <div key={key} className="dashboard-task">
                <span className="dashboard-task-label">{label}</span>
                <span className={`status-pill ${copy.cls}`}>{copy.label}</span>
              </div>
            );
          })}
        </div>
        <div className="dashboard-actions">
          <button
            className="dashboard-btn"
            onClick={handleRerun}
            disabled={rerunning}
            title="Re-run plot, character, and voice analysis"
          >
            {rerunning ? 'Queueing…' : 'Re-run analysis'}
          </button>
          {err && <span className="dashboard-err">{err}</span>}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-title">Chapters ({chapterFiles.length})</div>
        {chapterFiles.length === 0 ? (
          <div className="dashboard-hint">
            No chapters yet. Once the chapter split finishes they'll appear here and in the left pane.
          </div>
        ) : (
          <div className="dashboard-chapters">
            {chapterFiles.slice(0, 12).map(f => (
              <button
                key={f.path}
                className="dashboard-chapter-link"
                onClick={() => onSelectFile(f.path)}
              >
                {f.name.replace(/\.txt$/, '')}
              </button>
            ))}
            {chapterFiles.length > 12 && (
              <div className="dashboard-hint">+ {chapterFiles.length - 12} more in the chapter dropdown above</div>
            )}
          </div>
        )}
      </section>

      {analysisFiles.length > 0 && (
        <section className="dashboard-section">
          <div className="dashboard-section-title">Analysis output</div>
          <div className="dashboard-files">
            {analysisFiles.map(f => (
              <button
                key={f.path}
                className="dashboard-file-link"
                onClick={() => onSelectFile(f.path)}
              >
                {f.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="dashboard-footer">
        Tip — pick a chapter from the dropdown above (or in the Chapters list) to start editing.
        Use the right pane for analysis, context-building, or diff-based edits.
      </div>
    </div>
  );
}
