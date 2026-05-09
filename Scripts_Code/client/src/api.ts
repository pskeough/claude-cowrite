import type {
  FileNode, Mode, AIModel, ClaudeResponse, ChatMessage, ProcessEvent,
  Project, ProjectAnalysisConfig,
} from './types';

const BASE = '/api';

// ---- File operations (project-scoped via ?projectId=) ----

function projectParam(projectId?: string): string {
  return projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
}

export async function listFiles(projectId?: string): Promise<FileNode[]> {
  const res = await fetch(`${BASE}/files${projectParam(projectId)}`);
  if (!res.ok) throw new Error('Failed to list files');
  return res.json();
}

export async function readFile(filePath: string, projectId?: string): Promise<string> {
  const res = await fetch(`${BASE}/files/${filePath}${projectParam(projectId)}`);
  if (!res.ok) throw new Error(`Failed to read file: ${filePath}`);
  const data = await res.json();
  return data.content;
}

export async function writeFile(filePath: string, content: string, projectId?: string): Promise<void> {
  const res = await fetch(`${BASE}/files/${filePath}${projectParam(projectId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to write file: ${filePath}`);
}

export async function createDirectory(dirPath: string, projectId?: string): Promise<void> {
  const res = await fetch(`${BASE}/files/mkdir/${dirPath}${projectParam(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to create directory: ${dirPath}`);
}

// ---- AI message sending ----

export async function sendMessage(
  mode: Mode,
  message: string,
  centerPaneFile?: string,
  leftPaneFile?: string,
  history: ChatMessage[] = [],
  model?: AIModel,
  sessionId?: string,
  onProcess?: (event: ProcessEvent) => void,
  projectId?: string,
): Promise<ClaudeResponse> {
  const trimmedHistory = history
    .slice(-6)
    .map(({ role, content }) => ({ role, content: content.slice(0, 2000) }));

  const directMode = mode === 'edit';

  const res = await fetch(`${BASE}/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode,
      message,
      centerPaneFile,
      leftPaneFile,
      history: trimmedHistory,
      model,
      sessionId,
      directMode,
      projectId,
    }),
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Claude request failed');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));

      if (event.type === 'done') {
        return event.response as ClaudeResponse;
      } else if (event.type === 'error') {
        throw new Error(event.error);
      } else if (onProcess) {
        onProcess(event as ProcessEvent);
      }
    }
  }

  throw new Error('Stream ended without a response');
}

// ---- Project management ----

export async function listProjects(): Promise<Project[]> {
  const res = await fetch(`${BASE}/projects`);
  if (!res.ok) throw new Error('Failed to list projects');
  return res.json();
}

export async function getProjectById(id: string): Promise<Project> {
  const res = await fetch(`${BASE}/projects/${id}`);
  if (!res.ok) throw new Error('Failed to get project');
  return res.json();
}

export async function createProject(data: {
  name: string;
  description?: string;
  bookTitle?: string;
  author?: string;
  analysisConfig: ProjectAnalysisConfig;
}): Promise<Project> {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create project' }));
    throw new Error(err.error || 'Failed to create project');
  }
  return res.json();
}

export async function uploadBookFile(projectId: string, file: File): Promise<{ filename: string; size: number }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/projects/${projectId}/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

export async function splitProjectChapters(
  projectId: string,
  model: 'haiku' | 'sonnet' | 'opus' = 'sonnet',
): Promise<{ chaptersCreated: number; chapterFiles: string[] }> {
  const res = await fetch(`${BASE}/projects/${projectId}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Split failed' }));
    throw new Error(err.error || 'Chapter split failed');
  }
  return res.json();
}

export async function queueProjectAnalysis(
  projectId: string,
  options: {
    plotAnalysis: boolean;
    characterProfiles: boolean;
    voiceContext: boolean;
    model: 'haiku' | 'sonnet' | 'opus';
  },
): Promise<void> {
  const res = await fetch(`${BASE}/projects/${projectId}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to queue analysis' }));
    throw new Error(err.error || 'Failed to queue analysis');
  }
}


// ---- Auth ----

export interface AuthStatus {
  installed: boolean;
  version?: string;
  error?: string;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${BASE}/auth/status`);
  if (!res.ok) return { installed: false, error: 'Server error' };
  return res.json();
}

export async function launchClaudeLogin(): Promise<{ launched: boolean; message?: string }> {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST' });
  return res.json();
}

export async function installClaudeCode(): Promise<{ installed: boolean; message?: string; error?: string }> {
  const res = await fetch(`${BASE}/auth/install`, { method: 'POST' });
  return res.json();
}
