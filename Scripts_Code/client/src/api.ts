import type { FileNode, Mode, AIProvider, AIModel, ClaudeResponse, ChatMessage, ProcessEvent } from './types';

const BASE = '/api';

export async function listFiles(): Promise<FileNode[]> {
  const res = await fetch(`${BASE}/files`);
  if (!res.ok) throw new Error('Failed to list files');
  return res.json();
}

export async function readFile(path: string): Promise<string> {
  const res = await fetch(`${BASE}/files/${path}`);
  if (!res.ok) throw new Error(`Failed to read file: ${path}`);
  const data = await res.json();
  return data.content;
}

export async function writeFile(path: string, content: string): Promise<void> {
  const res = await fetch(`${BASE}/files/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to write file: ${path}`);
}

export async function createDirectory(path: string): Promise<void> {
  const res = await fetch(`${BASE}/files/mkdir/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to create directory: ${path}`);
}

export async function sendMessage(
  mode: Mode,
  message: string,
  centerPaneFile?: string,   // file path only — Claude reads it via tools
  leftPaneFile?: string,
  history: ChatMessage[] = [],
  model?: AIModel,
  provider?: AIProvider,
  sessionId?: string,        // resume a prior session (analysis/context modes)
  onProcess?: (event: ProcessEvent) => void,
): Promise<ClaudeResponse> {
  const res = await fetch(`${BASE}/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode,
      message,
      centerPaneFile,
      leftPaneFile,
      history: history.map(({ role, content }) => ({ role, content })),
      model,
      provider,
      sessionId,
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
