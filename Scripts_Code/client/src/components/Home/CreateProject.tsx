import { useState, useEffect, useRef } from 'react';
import type { Project, AnalysisModel } from '../../types';
import {
  createProject,
  uploadBookFile,
  splitProjectChapters,
  queueProjectAnalysis,
  getProjectById,
} from '../../api';

interface Props {
  onCreated: (project: Project) => void;
  onCancel: () => void;
}

type Step = 'form' | 'progress' | 'done';

interface FormState {
  name: string;
  bookTitle: string;
  author: string;
  description: string;
  // file upload
  file: File | null;
  // analysis options
  splitChapters: boolean;
  plotAnalysis: boolean;
  characterProfiles: boolean;
  voiceContext: boolean;
  model: AnalysisModel;
}

interface ProgressState {
  phase: string;
  detail: string;
  pct: number;
  errors: string[];
  project: Project | null;
}

export default function CreateProject({ onCreated, onCancel }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: '',
    bookTitle: '',
    author: '',
    description: '',
    file: null,
    splitChapters: true,
    plotAnalysis: false,
    characterProfiles: false,
    voiceContext: false,
    model: 'sonnet',
  });
  const [progress, setProgress] = useState<ProgressState>({
    phase: '',
    detail: '',
    pct: 0,
    errors: [],
    project: null,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const createdProjectRef = useRef<Project | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function set(field: keyof FormState, value: unknown) {
    setForm(f => ({ ...f, [field]: value }));
  }

  const needsAnalysis = form.plotAnalysis || form.characterProfiles || form.voiceContext;
  const needsSplit = (form.splitChapters && !!form.file) || (needsAnalysis);
  const canCreate = form.name.trim().length > 0;

  async function handleSubmit() {
    if (!canCreate || submitting) return;
    setSubmitting(true);

    try {
      // 1. Create project record
      setStep('progress');
      setProgress({ phase: 'Creating project...', detail: '', pct: 5, errors: [], project: null });

      const project = await createProject({
        name: form.name.trim(),
        bookTitle: form.bookTitle.trim() || form.name.trim(),
        author: form.author.trim(),
        description: form.description.trim(),
        analysisConfig: {
          splitChapters: form.splitChapters,
          plotAnalysis: form.plotAnalysis,
          characterProfiles: form.characterProfiles,
          voiceContext: form.voiceContext,
          model: form.model,
        },
      });
      createdProjectRef.current = project;

      let pct = 15;

      // 2. Upload file (if provided)
      if (form.file) {
        setProgress(p => ({ ...p, phase: 'Uploading book file...', pct }));
        await uploadBookFile(project.id, form.file);
        pct = 30;
      }

      // 3. Split chapters (if requested and file provided)
      if (form.splitChapters && form.file) {
        setProgress(p => ({ ...p, phase: 'Detecting chapter structure...', detail: 'Using Claude to analyze headings', pct }));
        const splitResult = await splitProjectChapters(project.id, form.model);
        pct = 55;
        setProgress(p => ({
          ...p,
          phase: `Chapters split`,
          detail: `${splitResult.chaptersCreated} chapters created`,
          pct,
        }));
      }

      // 4. Queue analysis (if selected)
      const hasAnalysis = form.plotAnalysis || form.characterProfiles || form.voiceContext;
      if (hasAnalysis) {
        await queueProjectAnalysis(project.id, {
          plotAnalysis: form.plotAnalysis,
          characterProfiles: form.characterProfiles,
          voiceContext: form.voiceContext,
          model: form.model,
        });

        // Poll for analysis completion
        setProgress(p => ({ ...p, phase: 'Running analysis...', detail: 'This may take a few minutes', pct: 60 }));
        startPolling(project.id);
      } else {
        // No analysis — done immediately
        setProgress(p => ({ ...p, phase: 'Project ready!', pct: 100, project }));
        setStep('done');
        createdProjectRef.current = project;
      }
    } catch (err: any) {
      setProgress(p => ({
        ...p,
        phase: 'Error',
        errors: [...p.errors, err.message],
        pct: Math.max(p.pct, 5),
      }));
    } finally {
      setSubmitting(false);
    }
  }

  function startPolling(projectId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const proj = await getProjectById(projectId);
        const { status, progress: jobProgress } = proj;

        const done = [status.plotAnalysis, status.characterProfiles, status.voiceContext]
          .filter(s => s !== 'none')
          .every(s => s === 'done' || s === 'error');

        const errors = [
          status.plotAnalysis === 'error' ? 'Plot analysis failed' : '',
          status.characterProfiles === 'error' ? 'Character analysis failed' : '',
          status.voiceContext === 'error' ? 'Voice analysis failed' : '',
          ...(jobProgress?.errors ?? []),
        ].filter(Boolean);

        const tasksDone = jobProgress?.tasksDone ?? 0;
        const tasksTotal = jobProgress?.tasksTotal ?? 1;
        const analysisPct = Math.floor(60 + (tasksDone / tasksTotal) * 40);

        setProgress(p => ({
          ...p,
          phase: done ? 'Analysis complete!' : (jobProgress?.currentTask ?? 'Analyzing...'),
          detail: `${tasksDone}/${tasksTotal} tasks done`,
          pct: done ? 100 : analysisPct,
          errors: errors as string[],
          project: done ? proj : null,
        }));

        if (done) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          createdProjectRef.current = proj;
          setStep('done');
        }
      } catch {
        // poll silently
      }
    }, 2500);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function handleOpenEditor() {
    const project = createdProjectRef.current;
    if (project) onCreated(project);
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.txt')) set('file', file);
  }

  if (step === 'form') {
    return (
      <div className="create-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
        <div className="create-modal">
          <h2>New Project</h2>

          {/* Basic info */}
          <div className="form-group">
            <label className="form-label">Project name *</label>
            <input
              className="form-input"
              placeholder="My Novel"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Book title</label>
            <input
              className="form-input"
              placeholder="Same as project name if left blank"
              value={form.bookTitle}
              onChange={e => set('bookTitle', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Author</label>
            <input
              className="form-input"
              placeholder="Author name"
              value={form.author}
              onChange={e => set('author', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              placeholder="Optional brief description"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={2}
            />
          </div>

          {/* File upload */}
          <div className="form-section-title">Book File (optional)</div>
          <div
            className={`upload-area${dragOver ? ' drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileDrop}
          >
            {form.file ? (
              <span className="upload-area-filename">📄 {form.file.name} ({(form.file.size / 1024).toFixed(0)} KB)</span>
            ) : (
              <span className="upload-area-text">Drop a .txt file here, or click to browse</span>
            )}
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={e => set('file', e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Analysis options */}
          <div className="form-section-title">Analysis Options</div>
          <div className="options-grid">
            <label className="option-row">
              <input
                type="checkbox"
                checked={form.splitChapters}
                onChange={e => set('splitChapters', e.target.checked)}
                disabled={!form.file}
              />
              <span className="option-text">
                Split into chapters
                <span className="option-sub">Claude detects the chapter structure and splits the uploaded file.</span>
                {!form.file && <span className="option-sub" style={{ color: '#e57373' }}>Upload a file to enable.</span>}
              </span>
            </label>

            <label className="option-row">
              <input
                type="checkbox"
                checked={form.plotAnalysis}
                onChange={e => set('plotAnalysis', e.target.checked)}
              />
              <span className="option-text">
                Plot & narrative analysis
                <span className="option-sub">Narrative arc, major events, themes, chapter summaries.</span>
              </span>
            </label>

            <label className="option-row">
              <input
                type="checkbox"
                checked={form.characterProfiles}
                onChange={e => set('characterProfiles', e.target.checked)}
              />
              <span className="option-text">
                Character profiles
                <span className="option-sub">Descriptions, psychology, dialogue samples, relationships, arcs.</span>
              </span>
            </label>

            <label className="option-row">
              <input
                type="checkbox"
                checked={form.voiceContext}
                onChange={e => set('voiceContext', e.target.checked)}
              />
              <span className="option-text">
                Authorial voice & ghost-writing context
                <span className="option-sub">Voice signature, rhythm, vocabulary, ghost-writing guide. Saved to editorial guidance.</span>
              </span>
            </label>
          </div>

          {/* Model selector */}
          {(needsSplit || needsAnalysis) && (
            <>
              <div className="form-section-title">Claude Model</div>
              <div className="model-tabs">
                {(['haiku', 'sonnet', 'opus'] as AnalysisModel[]).map(m => (
                  <button
                    key={m}
                    className={`model-tab${form.model === m ? ' active' : ''}`}
                    onClick={() => set('model', m)}
                    type="button"
                  >
                    {m === 'haiku' ? '⚡ Haiku — fast, cheap' : m === 'sonnet' ? '⚖ Sonnet — balanced' : '✦ Opus — highest quality'}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="modal-actions">
            <button className="btn-cancel" onClick={onCancel}>Cancel</button>
            <button
              className="btn-create"
              onClick={handleSubmit}
              disabled={!canCreate || submitting}
            >
              {submitting ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Progress / done screen
  return (
    <div className="create-modal-overlay">
      <div className="create-modal">
        <div className="progress-screen">
          {step === 'done' ? (
            <h3>Project Ready</h3>
          ) : (
            <h3>Setting up your project…</h3>
          )}

          <div className="progress-bar-wrap" style={{ width: '100%' }}>
            <div className="progress-bar-fill" style={{ width: `${progress.pct}%` }} />
          </div>

          <div className="progress-task">
            <strong>{progress.phase}</strong>
            {progress.detail && <div style={{ marginTop: 4, color: '#999', fontSize: '0.8rem' }}>{progress.detail}</div>}
          </div>

          {step !== 'done' && <div className="spinner" />}

          {progress.errors.length > 0 && (
            <div className="progress-errors">
              {progress.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
            </div>
          )}

          <button
            className="btn-open-editor"
            onClick={handleOpenEditor}
            disabled={!createdProjectRef.current}
          >
            {step === 'done' ? 'Open in Editor →' : 'Open Editor (skip analysis)'}
          </button>

          {step !== 'done' && (
            <p style={{ fontSize: '0.76rem', color: '#aaa', maxWidth: 340 }}>
              Analysis runs in the background. You can open the editor now and it will finish automatically.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
