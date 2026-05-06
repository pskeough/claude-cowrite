import { useState, useEffect } from 'react';
import type { Project } from '../../types';
import { listProjects } from '../../api';
import ProjectCard from './ProjectCard';
import CreateProject from './CreateProject';
import './home.css';

interface Props {
  onOpenProject: (project: Project) => void;
  onToggleDark: () => void;
  dark: boolean;
}

export default function HomePage({ onOpenProject, onToggleDark, dark }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    try {
      const list = await listProjects();
      setProjects(list);
    } catch (err: any) {
      setError(`Failed to load projects: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  function handleCreated(project: Project) {
    setShowCreate(false);
    onOpenProject(project);
  }

  return (
    <div className="home-page">
      <header className="home-header">
        <span className="home-header-title">AI Book Editor</span>
        <div className="home-header-actions">
          <button className="dark-toggle" onClick={onToggleDark}>
            {dark ? 'Light' : 'Dark'}
          </button>
          <button className="btn-new-project" onClick={() => setShowCreate(true)}>
            + New Project
          </button>
        </div>
      </header>

      <main className="home-content">
        {error && (
          <div
            style={{ background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: 6, marginBottom: 20, fontSize: '0.85rem', cursor: 'pointer' }}
            onClick={() => setError(null)}
          >
            {error}
          </div>
        )}

        <div className="home-section-title">Projects</div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <div className="spinner" />
          </div>
        ) : projects.length === 0 ? (
          <div className="home-empty">
            <strong>No projects yet</strong>
            Create your first project to get started.
          </div>
        ) : (
          <div className="project-grid">
            {projects.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={onOpenProject}
              />
            ))}
          </div>
        )}
      </main>

      {showCreate && (
        <CreateProject
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
