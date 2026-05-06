import { useState, useEffect, useCallback, useRef } from 'react';
import Layout from './components/Layout';
import LeftPane from './components/LeftPane/LeftPane';
import CenterPane from './components/CenterPane/CenterPane';
import RightPane from './components/RightPane/RightPane';
import HomePage from './components/Home/HomePage';
import { listFiles, readFile, writeFile, createDirectory, sendMessage } from './api';
import type { FileNode, Mode, AIProvider, AIModel, ChatMessage, EditProposal, ProcessEvent, Project } from './types';

type AppView = 'home' | 'editor';
type ModeSessions = Record<Mode, string | null>;

export default function App() {
  const [view, setView] = useState<AppView>('home');
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
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
  const [sessions, setSessions] = useState<ModeSessions>({ analysis: null, context: null, edit: null });

  const projectId = currentProject?.id;

  useEffect(() => {
    document.body.classList.toggle('dark', dark);
  }, [dark]);

  const refreshFiles = useCallback(() => {
    listFiles(projectId)
      .then(setFiles)
      .catch(err => setError(`Failed to load files: ${err.message}`));
  }, [projectId]);

  useEffect(() => {
    if (view === 'editor') refreshFiles();
  }, [view, refreshFiles]);

  function handleOpenProject(project: Project) {
    setCurrentProject(project);
    // Reset editor state when switching projects
    setLeftFile(null);
    setLeftContent(null);
    setCenterFile(null);
    setCenterContent('');
    setEditProposal(null);
    setMessages([]);
    setSessions({ analysis: null, context: null, edit: null });
    setFiles([]);
    setView('editor');
  }

  const handleLeftFileSelect = useCallback(async (path: string) => {
    if (leftSaveTimerRef.current) {
      clearTimeout(leftSaveTimerRef.current);
      leftSaveTimerRef.current = null;
      if (leftFileRef.current) {
        try { await writeFile(leftFileRef.current, leftContentRef.current, projectId); } catch { /* best-effort */ }
      }
    }
    setLeftFile(path);
    leftFileRef.current = path;
    setLeftContent(null);
    setLeftSaveStatus('idle');
    try {
      const content = await readFile(path, projectId);
      setLeftContent(content);
      leftContentRef.current = content;
      setLeftContentVersion(v => v + 1);
    } catch (err: any) {
      setError(`Failed to read file: ${err.message}`);
    }
  }, [projectId]);

  const handleLeftContentChange = useCallback((content: string) => {
    leftContentRef.current = content;
    setLeftSaveStatus('idle');
    if (leftSaveTimerRef.current) clearTimeout(leftSaveTimerRef.current);
    leftSaveTimerRef.current = setTimeout(async () => {
      const file = leftFileRef.current;
      if (!file) return;
      setLeftSaveStatus('saving');
      try {
        await writeFile(file, content, projectId);
        setLeftSaveStatus('saved');
      } catch {
        setLeftSaveStatus('error');
      }
    }, 2000);
  }, [projectId]);

  const handleCenterFileSelect = useCallback(async (path: string) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (centerFileRef.current) {
        try { await writeFile(centerFileRef.current, centerContentRef.current, projectId); } catch { /* best-effort */ }
      }
    }
    setCenterFile(path);
    centerFileRef.current = path;
    setEditProposal(null);
    setSaveStatus('idle');
    try {
      const content = await readFile(path, projectId);
      setCenterContent(content);
      centerContentRef.current = content;
      setContentVersion(v => v + 1);
    } catch (err: any) {
      setError(`Failed to read file: ${err.message}`);
    }
  }, [projectId]);

  const handleContentChange = useCallback((content: string) => {
    centerContentRef.current = content;
    setSaveStatus('idle');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const file = centerFileRef.current;
      if (!file) return;
      setSaveStatus('saving');
      try {
        await writeFile(file, content, projectId);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 2000);
  }, [projectId]);

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
        if (centerFile) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          setSaveStatus('saving');
          writeFile(centerFile, centerContentRef.current, projectId)
            .then(() => setSaveStatus('saved'))
            .catch(() => setSaveStatus('error'));
        }
        if (leftFileRef.current) {
          if (leftSaveTimerRef.current) clearTimeout(leftSaveTimerRef.current);
          setLeftSaveStatus('saving');
          writeFile(leftFileRef.current, leftContentRef.current, projectId)
            .then(() => setLeftSaveStatus('saved'))
            .catch(() => setLeftSaveStatus('error'));
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [centerFile, projectId]);

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode);
    setEditProposal(null);
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

    const currentSessionId = mode !== 'edit' ? (sessions[mode] ?? undefined) : undefined;

    if (mode === 'edit' && centerFile) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        await writeFile(centerFile, centerContentRef.current, projectId).catch(() => {});
      }
    }

    try {
      const response = await sendMessage(
        mode,
        message,
        centerFile || undefined,
        leftFile || undefined,
        messages,
        model,
        provider,
        currentSessionId,
        wrappedOnProcess,
        projectId,
      );

      if (response.sessionId && mode !== 'edit') {
        setSessions(prev => ({ ...prev, [mode]: response.sessionId! }));
      }

      if (response.type === 'edit_proposal') {
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
        if (mode === 'context') refreshFiles();
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
  }, [mode, provider, model, messages, sessions, centerFile, leftFile, projectId, refreshFiles]);

  const handleApplyDiff = useCallback(async (finalText: string) => {
    setEditProposal(null);
    setCenterContent(finalText);
    centerContentRef.current = finalText;
    setContentVersion(v => v + 1);
    if (!centerFile) return;
    setSaveStatus('saving');
    try {
      await writeFile(centerFile, finalText, projectId);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, [centerFile, projectId]);

  const handleNewSession = useCallback(() => {
    setMessages([]);
    setEditProposal(null);
    setSessions({ analysis: null, context: null, edit: null });
  }, []);

  const handleCreateFile = useCallback(async (filePath: string) => {
    try {
      await writeFile(filePath, '', projectId);
      refreshFiles();
    } catch (err: any) {
      setError(`Failed to create file: ${err.message}`);
    }
  }, [projectId, refreshFiles]);

  const handleCreateFolder = useCallback(async (dirPath: string) => {
    try {
      await createDirectory(dirPath, projectId);
      refreshFiles();
    } catch (err: any) {
      setError(`Failed to create folder: ${err.message}`);
    }
  }, [projectId, refreshFiles]);

  const handleProviderChange = useCallback((newProvider: AIProvider) => {
    setProvider(newProvider);
    setModel(newProvider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-pro');
  }, []);

  // ---- Home view ----
  if (view === 'home') {
    return (
      <HomePage
        onOpenProject={handleOpenProject}
        onToggleDark={() => setDark(d => !d)}
        dark={dark}
      />
    );
  }

  // ---- Editor view ----
  const projectLabel = currentProject
    ? (currentProject.bookTitle || currentProject.name)
    : 'Editor';

  return (
    <div className="app-container">
      <div className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '0.8rem', padding: '2px 4px' }}
            onClick={() => setView('home')}
            title="Back to projects"
          >
            ← Projects
          </button>
          <h1>{projectLabel}</h1>
        </div>
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
