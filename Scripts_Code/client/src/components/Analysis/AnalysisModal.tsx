import { useState, useEffect, useRef } from 'react';
import type { FileNode, AnalysisEvent, PipelineStatus } from '../../types';
import { startAnalysisPipeline, getAnalysisStatus, cancelAnalysis } from '../../api';

type AnalysisType = 'plot' | 'character' | 'voice';
type Phase = 'settings' | 'running' | 'done';

const TYPE_LABELS: Record<AnalysisType, string> = {
  plot: 'Plot & Narrative',
  character: 'Character & Voice',
  voice: 'Authorial Voice',
};

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet' },
  { id: 'claude-opus-4-6', label: 'Opus' },
] as const;

function getManuscripts(nodes: FileNode[]): string[] {
  const rawDir = nodes.find(n => n.name === 'RawFiles' && n.type === 'directory');
  if (!rawDir?.children) return [];
  return rawDir.children
    .filter(n => n.type === 'file' && (n.name.endsWith('.txt') || n.name.endsWith('.md')))
    .map(n => n.path);
}

interface Props {
  files: FileNode[];
  onClose: (refreshFiles?: boolean) => void;
}

export default function AnalysisModal({ files, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('settings');
  const [manuscript, setManuscript] = useState('');
  const [analysisTypes, setAnalysisTypes] = useState<AnalysisType[]>(['plot', 'character', 'voice']);
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [chunkSize, setChunkSize] = useState(40_000);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resumeState, setResumeState] = useState<PipelineStatus | null>(null);

  const [currentType, setCurrentType] = useState<AnalysisType | null>(null);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [totalChunksForType, setTotalChunksForType] = useState(0);
  const [typesDone, setTypesDone] = useState<string[]>([]);
  const [lastSummaryLine, setLastSummaryLine] = useState('');
  const [toolLog, setToolLog] = useState<AnalysisEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<(() => void) | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const manuscripts = getManuscripts(files);

  useEffect(() => {
    if (manuscripts.length > 0 && !manuscript) {
      setManuscript(manuscripts[0]);
    }
  }, [manuscripts]);

  useEffect(() => {
    getAnalysisStatus().then(status => {
      if (status && status.status === 'running') {
        setResumeState(status);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [toolLog]);

  const toggleType = (type: AnalysisType) => {
    setAnalysisTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleStart = (resume = false) => {
    setPhase('running');
    setError(null);
    setToolLog([]);
    setTypesDone([]);
    setCurrentType(null);
    setChunkIndex(0);
    setTotalChunksForType(0);
    setLastSummaryLine('');

    const typesToRun = resume && resumeState
      ? (['plot', 'character', 'voice'] as AnalysisType[]).filter(
          t => !resumeState.completedTypes.includes(t)
        )
      : analysisTypes;

    const { abort } = startAnalysisPipeline(
      {
        manuscriptPath: manuscript,
        analysisTypes: typesToRun,
        model,
        chunkSize,
        resume,
      },
      (event) => {
        if (event.type === 'chunk_start') {
          setCurrentType(event.analysisType as AnalysisType);
          setChunkIndex(event.chunkIndex ?? 0);
          setTotalChunksForType(event.totalChunksForType ?? 0);
        } else if (event.type === 'analysis_type_done') {
          setTypesDone(prev => [...prev, event.analysisType!]);
        } else if (event.type === 'text_delta' && event.text) {
          const line = event.text.trim();
          if (line.includes('COMPLETE —') || line.includes('COMPLETE -')) {
            setLastSummaryLine(line);
          }
        } else if (event.type === 'pipeline_done') {
          setPhase('done');
        } else if (event.type === 'error') {
          if (!event.recoverable) {
            setError(event.error ?? 'Pipeline error');
            setPhase('done');
          }
        }

        if (
          event.type === 'tool_call' ||
          event.type === 'tool_result' ||
          event.type === 'cost_info'
        ) {
          setToolLog(prev => [...prev, event]);
        }
      }
    );

    abortRef.current = abort;
  };

  const handleAbort = async () => {
    abortRef.current?.();
    await cancelAnalysis();
    onClose(false);
  };

  const progressPct = totalChunksForType > 0 ? ((chunkIndex - 1) / totalChunksForType) * 100 : 0;

  // ── Settings phase ──────────────────────────────────────────────────────────
  if (phase === 'settings') {
    return (
      <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose(false)}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">Whole-Book Analysis</h2>
            <button className="modal-close" onClick={() => onClose(false)}>×</button>
          </div>

          <div className="modal-body">
            {resumeState && (
              <div className="modal-resume-banner">
                <span>
                  Interrupted run detected — {resumeState.completedTypes.length > 0
                    ? `${resumeState.completedTypes.map(t => TYPE_LABELS[t as AnalysisType] ?? t).join(', ')} complete.`
                    : 'No types completed.'}
                </span>
                <button className="modal-resume-btn" onClick={() => handleStart(true)}>
                  Resume
                </button>
              </div>
            )}

            <div className="modal-field">
              <label className="modal-label">Manuscript</label>
              <select
                className="modal-select"
                value={manuscript}
                onChange={e => setManuscript(e.target.value)}
              >
                {manuscripts.map(m => (
                  <option key={m} value={m}>{m.split('/').pop()}</option>
                ))}
                {manuscripts.length === 0 && (
                  <option value="">No manuscripts found in RawFiles/</option>
                )}
              </select>
            </div>

            <div className="modal-field">
              <label className="modal-label">Analysis types</label>
              <div className="modal-checkboxes">
                {(['plot', 'character', 'voice'] as AnalysisType[]).map(type => (
                  <label key={type} className="modal-checkbox-label">
                    <input
                      type="checkbox"
                      checked={analysisTypes.includes(type)}
                      onChange={() => toggleType(type)}
                    />
                    {TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-field">
              <label className="modal-label">Model</label>
              <div className="mode-selector" style={{ width: 'fit-content' }}>
                {MODELS.map(m => (
                  <button
                    key={m.id}
                    className={`mode-btn${model === m.id ? ' active' : ''}`}
                    onClick={() => setModel(m.id)}
                    type="button"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {analysisTypes.includes('voice') && model !== 'claude-opus-4-6' && (
                <span className="modal-hint">Opus recommended for Authorial Voice</span>
              )}
            </div>

            <button
              className="modal-advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
              type="button"
            >
              {showAdvanced ? '▼' : '▶'} Advanced
            </button>

            {showAdvanced && (
              <div className="modal-field">
                <label className="modal-label">
                  Chunk size: {Math.round(chunkSize / 1000)}K chars
                  <span className="modal-hint" style={{ marginLeft: '8px' }}>
                    (~{Math.round(chunkSize / 5)} words per chunk)
                  </span>
                </label>
                <input
                  type="range"
                  min={20000}
                  max={80000}
                  step={5000}
                  value={chunkSize}
                  onChange={e => setChunkSize(Number(e.target.value))}
                  className="modal-range"
                />
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button className="dark-toggle" onClick={() => onClose(false)}>Cancel</button>
            <button
              className="chat-send-btn"
              disabled={!manuscript || analysisTypes.length === 0}
              onClick={() => handleStart(false)}
              type="button"
            >
              Start Analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Running / done phase ────────────────────────────────────────────────────
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">
            {phase === 'done' ? 'Analysis complete' : 'Analyzing…'}
          </h2>
          {phase === 'done' && (
            <button className="modal-close" onClick={() => onClose(true)}>×</button>
          )}
        </div>

        <div className="modal-body">
          {currentType && (
            <div className="modal-progress-section">
              <div className="modal-progress-label">
                {TYPE_LABELS[currentType]}
                {totalChunksForType > 0 && (
                  <span className="modal-progress-counter">
                    {' '}— chunk {chunkIndex} of {totalChunksForType}
                  </span>
                )}
              </div>
              <div className="modal-progress-bar">
                <div
                  className="modal-progress-fill"
                  style={{ width: `${Math.max(2, progressPct)}%` }}
                />
              </div>
              {lastSummaryLine && (
                <div className="modal-progress-summary">{lastSummaryLine}</div>
              )}
            </div>
          )}

          {toolLog.length > 0 && (
            <div className="process-log" style={{ margin: '8px 0' }}>
              <div className="process-log-entries" style={{ maxHeight: '180px' }}>
                {toolLog.slice(-30).map((evt, i) => {
                  if (evt.type === 'tool_call') {
                    const detail = evt.input && (evt.tool === 'Read' || evt.tool === 'Write' || evt.tool === 'Edit')
                      ? String(evt.input.file_path ?? '').split('/').pop()
                      : '';
                    const icon = evt.tool === 'Read' ? '📖' : '✏️';
                    return (
                      <div key={i} className="process-entry process-entry-call">
                        <span className="process-icon">{icon}</span>
                        <span className="process-tool">{evt.tool}</span>
                        {detail && <span className="process-detail">{detail}</span>}
                      </div>
                    );
                  }
                  if (evt.type === 'tool_result') {
                    return (
                      <div key={i} className={`process-entry process-entry-result${evt.isError ? ' process-entry-error' : ''}`}>
                        <span className="process-icon">{evt.isError ? '✗' : '✓'}</span>
                        <span className="process-tool">{evt.tool}</span>
                        <span className="process-detail">{evt.isError ? 'error' : 'ok'}</span>
                      </div>
                    );
                  }
                  if (evt.type === 'cost_info') {
                    const parts: string[] = [];
                    if (evt.durationMs != null) parts.push(`${(evt.durationMs / 1000).toFixed(1)}s`);
                    if (evt.costUsd != null) parts.push(`$${evt.costUsd.toFixed(4)}`);
                    return (
                      <div key={i} className="process-entry process-entry-cost">
                        <span className="process-icon">💰</span>
                        <span className="process-detail">{parts.join(' · ')}</span>
                      </div>
                    );
                  }
                  return null;
                })}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {typesDone.length > 0 && (
            <div className="modal-types-done">
              {typesDone.map(t => (
                <span key={t} className="modal-type-badge">
                  ✓ {TYPE_LABELS[t as AnalysisType] ?? t}
                </span>
              ))}
            </div>
          )}

          {error && (
            <div className="error-banner" style={{ margin: '8px 0', borderRadius: '4px' }}>
              {error}
            </div>
          )}

          {phase === 'done' && !error && (
            <div className="modal-done-note">
              Output saved to AI_Analysis_Output/
            </div>
          )}
        </div>

        <div className="modal-footer">
          {phase === 'running' ? (
            <button className="dark-toggle" onClick={handleAbort}>Abort</button>
          ) : (
            <button className="chat-send-btn" onClick={() => onClose(true)}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
