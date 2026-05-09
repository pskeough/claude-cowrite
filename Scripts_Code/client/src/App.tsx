import { useState, useEffect, useCallback, useRef } from 'react';
import Layout from './components/Layout';
import LeftPane from './components/LeftPane/LeftPane';
import CenterPane from './components/CenterPane/CenterPane';
import RightPane from './components/RightPane/RightPane';
import AnalysisModal from './components/Analysis/AnalysisModal';
import { listFiles, readFile, writeFile, createDirectory, sendMessage } from './api';
import type { FileNode, Mode, AIProvider, AIModel, ChatMessage, EditProposal, ProcessEvent } from './types';

type ModeSessions = Record<Mode, string | null>;

export default function App() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [dark, setDark] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Left pane state
  const [leftFile, setLeftFile] = useState<string | null>(null);
  const [leftContent, setLeftContent] = useState<string | null>(null);
  const [leftSaveStatus, setLeftSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [leftContentVersion, setLeftContentVersion] = useState(0);
  const leftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leftFileRef = useRef<string | null>(null);
  const leftContentRef = useRef<string>('');

  // Center pane state
  const [centerFile, setCenterFile] = useState<string | null>(null);
  const [centerContent, setCenterContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [editProposal, setEditProposal] = useState<EditProposal | null>(null);
  const [contentVersion, setContentVersion] = useState(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const centerFileRef = useRef<string | null>(null);
  const centerContentRef = useRef<string>('');

  // Right pane state
  const [mode, setMode] = useState<Mode>('analysis');
  const [provider, setProvider] = useState<AIProvider>('claude');
  const [model, setModel] = useState<AIModel>('claude-sonnet-4-6');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');

  // Session IDs per mode — Claude Code maintains conversation context on disk,
  // we resume using the session_id returned from each call.
  const [sessions, setSessions] = useState<ModeSessions>({ analysis: null, context: null, edit: null });

  const [showAnalysisModal, setShowAnalysisModal] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('dark', dark);
  }, [dark]);

  const refreshFiles = useCallback(() => {
    listFiles()
      .then(setFiles)
      .catch(err => setError(`Failed to load files: ${err.message}`));
  }, []);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const handleLeftFileSelect = useCallback(async (path: string) => {
    // Flush pending left-pane saves before switching
    if (leftSaveTimerRef.current) {
      clearTimeout(leftSaveTimerRef.current);
      leftSaveTimerRef.current = null;
      const prevFile = leftFileRef.current;
      if (prevFile) {
        try { await writeFile(prevFile, leftContentRef.current); } catch { /* best-effort */ }
      }
    }
    setLeftFile(path);
    leftFileRef.current = path;
    setLeftContent(null);
    setLeftSaveStatus('idle');
    try {
      const content = await readFile(path);
      setLeftContent(content);
      leftContentRef.current = content;
      setLeftContentVersion(v => v + 1);
    } catch (err: any) {
      setError(`Failed to read file: ${err.message}`);
    }
  }, []);

  const handleLeftContentChange = useCallback((content: string) => {
    leftContentRef.current = content;
    setLeftSaveStatus('idle');
    if (leftSaveTimerRef.current) clearTimeout(leftSaveTimerRef.current);
    leftSaveTimerRef.current = setTimeout(async () => {
      const file = leftFileRef.current;
      if (!file) return;
      setLeftSaveStatus('saving');
      try {
        await writeFile(file, content);
        setLeftSaveStatus('saved');
      } catch {
        setLeftSaveStatus('error');
      }
    }, 2000);
  }, []);

  const handleCenterFileSelect = useCallback(async (path: string) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const prevFile = centerFileRef.current;
      if (prevFile) {
        try { await writeFile(prevFile, centerContentRef.current); } catch { /* best-effort */ }
      }
    }
    setCenterFile(path);
    centerFileRef.current = path;
    setEditProposal(null);
    setSaveStatus('idle');
    try {
      const content = await readFile(path);
      setCenterContent(content);
      centerContentRef.current = content;
      setContentVersion(v => v + 1);
    } catch (err: any) {
      setError(`Failed to read file: ${err.message}`);
    }
  }, []);

  const handleContentChange = useCallback((content: string) => {
    centerContentRef.current = content;
    setSaveStatus('idle');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const file = centerFileRef.current;
      if (!file) return;
      setSaveStatus('saving');
      try {
        await writeFile(file, content);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 2000);
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'saving' || saveTimerRef.current !== null ||
          leftSaveStatus === 'saving' || leftSaveTimerRef.current !== null) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus, leftSaveStatus]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        // Save center pane
        if (centerFile) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          setSaveStatus('saving');
          writeFile(centerFile, centerContentRef.current)
            .then(() => setSaveStatus('saved'))
            .catch(() => setSaveStatus('error'));
        }
        // Save left pane
        if (leftFileRef.current) {
          if (leftSaveTimerRef.current) clearTimeout(leftSaveTimerRef.current);
          setLeftSaveStatus('saving');
          writeFile(leftFileRef.current, leftContentRef.current)
            .then(() => setLeftSaveStatus('saved'))
            .catch(() => setLeftSaveStatus('error'));
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [centerFile]);

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode);
    setEditProposal(null);
    // Preserve per-mode sessions and message history — switching modes doesn't reset context
  }, []);

  const handleSend = useCallback(async (message: string, onProcess?: (e: ProcessEvent) => void) => {
    const userMsg: ChatMessage = { role: 'user', content: message, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setStreamingText('');
    setError(null);

    const wrappedOnProcess = (evt: ProcessEvent) => {
      if (evt.type === 'text_delta' && evt.text) {
        setStreamingText(prev => prev + evt.text);
      } else {
        onProcess?.(evt);
      }
    };

    // Session ID for this mode — enables --resume on the Claude Code subprocess
    // so Claude maintains its own context natively without manual history injection.
    // Edit mode is stateless (file-diff approach), so no session needed.
    const currentSessionId = mode !== 'edit' ? (sessions[mode] ?? undefined) : undefined;

    // Edit mode: flush any pending auto-save before spawning Claude so Claude reads
    // the latest content, and cancel the timer so it can't fire mid-flight and
    // overwrite Claude's disk edits.
    if (mode === 'edit' && centerFile) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        await writeFile(centerFile, centerContentRef.current).catch(() => {});
      }
    }

    try {
      const response = await sendMessage(
        mode,
        message,
        centerFile || undefined,   // file path only — Claude reads it via its tools
        leftFile || undefined,
        messages,
        model,
        provider,
        currentSessionId,
        wrappedOnProcess,
      );

      // Store session ID for this mode so subsequent calls can --resume
      if (response.sessionId && mode !== 'edit') {
        setSessions(prev => ({ ...prev, [mode]: response.sessionId! }));
      }

      if (response.type === 'edit_proposal') {
        // Claude already edited the file on disk via its Edit tool.
        // Store the proposal (with originalText for reject/restore) and sync center pane.
        setEditProposal({
          explanation: response.explanation,
          diffs: response.diffs,
          revisedText: response.revisedText,
          originalText: response.originalText,
        });
        setCenterContent(response.revisedText);
        centerContentRef.current = response.revisedText;
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: response.explanation,
          timestamp: Date.now(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: response.response,
          timestamp: Date.now(),
        }]);
        // Refresh file tree after context mode — Claude may have written new files to disk
        if (mode === 'context') {
          refreshFiles();
        }
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
      setStreamingText('');
    }
  }, [mode, provider, model, messages, sessions, centerFile, leftFile, refreshFiles]);

  // Apply diff — writes the user's final text (from per-hunk accept/reject decisions) to disk.
  const handleApplyDiff = useCallback(async (finalText: string) => {
    setEditProposal(null);
    setCenterContent(finalText);
    centerContentRef.current = finalText;
    setContentVersion(v => v + 1);
    if (!centerFile) return;
    setSaveStatus('saving');
    try {
      await writeFile(centerFile, finalText);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, [centerFile]);

  const handleNewSession = useCallback(() => {
    setMessages([]);
    setEditProposal(null);
    setSessions({ analysis: null, context: null, edit: null });
  }, []);

  const handleCreateFile = useCallback(async (filePath: string) => {
    try {
      await writeFile(filePath, '');
      refreshFiles();
    } catch (err: any) {
      setError(`Failed to create file: ${err.message}`);
    }
  }, [refreshFiles]);

  const handleCreateFolder = useCallback(async (dirPath: string) => {
    try {
      await createDirectory(dirPath);
      refreshFiles();
    } catch (err: any) {
      setError(`Failed to create folder: ${err.message}`);
    }
  }, [refreshFiles]);

  const handleProviderChange = useCallback((newProvider: AIProvider) => {
    setProvider(newProvider);
    if (newProvider === 'claude') {
      setModel('claude-sonnet-4-6');
    } else {
      setModel('gemini-2.5-pro');
    }
  }, []);

  return (
    <div className="app-container">
      {showAnalysisModal && (
        <AnalysisModal
          files={files}
          onClose={(shouldRefresh) => {
            setShowAnalysisModal(false);
            if (shouldRefresh) refreshFiles();
          }}
        />
      )}
      <div className="app-header">
        <h1>The Basilisk</h1>
        <div className="app-header-controls">
          <button className="dark-toggle" onClick={() => setDark(!dark)}>
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>
      {error && (
        <div className="error-banner" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      <div className="app-body">
        <Layout
          left={
            <LeftPane
              files={files}
              selectedFile={leftFile}
              fileContent={leftContent}
              saveStatus={leftSaveStatus}
              contentVersion={leftContentVersion}
              onSelectFile={handleLeftFileSelect}
              onContentChange={handleLeftContentChange}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onRefresh={refreshFiles}
              onAnalyze={() => setShowAnalysisModal(true)}
            />
          }
          center={
            <CenterPane
              files={files}
              selectedFile={centerFile}
              content={centerContent}
              contentVersion={contentVersion}
              saveStatus={saveStatus}
              editProposal={editProposal}
              onSelectFile={handleCenterFileSelect}
              onContentChange={handleContentChange}
              onApplyDiff={handleApplyDiff}
            />
          }
          right={
            <RightPane
              mode={mode}
              provider={provider}
              model={model}
              messages={messages}
              loading={loading}
              streamingText={streamingText}
              onModeChange={handleModeChange}
              onProviderChange={handleProviderChange}
              onModelChange={setModel}
              onSend={handleSend}
              onNewSession={handleNewSession}
            />
          }
        />
      </div>
    </div>
  );
}
