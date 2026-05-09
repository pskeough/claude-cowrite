import { useState, useEffect } from 'react';
import type { Project } from '../../types';
import { listProjects, getAuthStatus, launchClaudeLogin, installClaudeCode } from '../../api';
import type { AuthStatus } from '../../api';
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
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [installing, setInstalling] = useState(false);

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

  async function checkAuth() {
    try {
      const status = await getAuthStatus();
      setAuth(status);
    } catch {
      setAuth({ installed: false, error: 'Could not reach server' });
    }
  }

  useEffect(() => {
    loadProjects();
    checkAuth();
  }, []);

  async function handleLaunchLogin() {
    setAuthLoading(true);
    try {
      await launchClaudeLogin();
    } finally {
      setAuthLoading(false);
      setTimeout(checkAuth, 3000);
    }
  }

  async function handleInstall() {
    setInstalling(true);
    setError(null);
    try {
      const result = await installClaudeCode();
      if (result.installed) {
        await checkAuth();
      } else {
        setError(`Install failed: ${result.error || 'unknown error'}`);
      }
    } catch (err: any) {
      setError(`Install failed: ${err.message}`);
    } finally {
      setInstalling(false);
    }
  }

  function handleCreated(project: Project) {
    setShowCreate(false);
    onOpenProject(project);
  }

  const authConnected = auth?.installed === true;

  return (
    <div className="home-page">
      <header className="home-header">
        <span className="home-header-title">AI Book Editor</span>
        <div className="home-header-actions">
          {auth && (
            <div className={`claude-status ${authConnected ? 'claude-status--ok' : 'claude-status--warn'}`}>
              <span className="claude-status-dot" />
              {authConnected
                ? `Claude Code connected${auth.version ? ` · ${auth.version}` : ''}`
                : 'Claude Code not found'}
              {!authConnected && (
                <button
                  className="claude-status-btn"
                  onClick={handleLaunchLogin}
                  disabled={authLoading || installing}
                >
                  {authLoading ? 'Opening…' : 'Sign In'}
                </button>
              )}
            </div>
          )}
          <button className="dark-toggle" onClick={onToggleDark}>
            {dark ? 'Light' : 'Dark'}
          </button>
          <button
            className="btn-new-project"
            onClick={() => setShowCreate(true)}
            disabled={!authConnected}
            title={authConnected ? undefined : 'Connect Claude Code first'}
          >
            + New Project
          </button>
        </div>
      </header>

      {!authConnected && auth !== null && (
        <div className="auth-banner">
          <div className="auth-banner-content">
            <div className="auth-banner-title">Connect Claude Code to get started</div>
            <p className="auth-banner-body">
              This app is fully local and uses the Claude Code CLI for every AI feature —
              no API keys to copy and no data leaves your machine. You'll need it installed
              and signed in before you can create or open a project.
            </p>
            <div className="auth-banner-actions">
              <button
                className="auth-banner-btn auth-banner-btn--primary"
                onClick={handleInstall}
                disabled={installing || authLoading}
              >
                {installing ? 'Installing… (1–2 min)' : 'Install Claude Code'}
              </button>
              <button
                className="auth-banner-btn"
                onClick={handleLaunchLogin}
                disabled={authLoading || installing}
              >
                {authLoading ? 'Opening…' : 'I already have it — Sign In'}
              </button>
              <button
                className="auth-banner-btn auth-banner-btn--ghost"
                onClick={checkAuth}
              >
                Re-check
              </button>
            </div>
            <div className="auth-banner-hint">
              Manual install: <code>npm install -g @anthropic-ai/claude-code</code>
              {auth.error && <span className="auth-banner-err"> · {auth.error}</span>}
            </div>
          </div>
        </div>
      )}

      <main className="home-content">
        {error && (
          <div className="home-error" onClick={() => setError(null)}>
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
            <div className="home-empty-icon">📖</div>
            <div className="home-empty-title">Start a new book project</div>
            <p className="home-empty-body">
              Upload a manuscript as a <code>.txt</code> file. The editor will auto-split it into
              chapters, then run optional plot, character, and authorial-voice analyses in the
              background. Everything stays in <code>Projects/</code> on your disk.
            </p>
            <ol className="home-empty-steps">
              <li>Connect Claude Code (top-right).</li>
              <li>Click <strong>+ New Project</strong> and upload your <code>.txt</code>.</li>
              <li>Pick which analyses to run — open the editor as soon as chapters split.</li>
            </ol>
            <button
              className="btn-new-project"
              onClick={() => setShowCreate(true)}
              disabled={!authConnected}
              title={authConnected ? undefined : 'Connect Claude Code first'}
            >
              + Create your first project
            </button>
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
