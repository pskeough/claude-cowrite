// ---- Multi-project types ----

export type AnalysisModel = 'haiku' | 'sonnet' | 'opus';

export interface ProjectAnalysisConfig {
  splitChapters: boolean;
  plotAnalysis: boolean;
  characterProfiles: boolean;
  voiceContext: boolean;
  model: AnalysisModel;
}

export type TaskStatus = 'none' | 'pending' | 'running' | 'done' | 'error';

export interface ProjectStatus {
  splitChapters: TaskStatus;
  plotAnalysis: TaskStatus;
  characterProfiles: TaskStatus;
  voiceContext: TaskStatus;
}

export interface JobProgress {
  currentTask: string;
  tasksTotal: number;
  tasksDone: number;
  errors: string[];
  complete: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  bookTitle: string;
  author: string;
  created: string;
  lastOpened?: string;
  rawFile?: string;
  analysisConfig: ProjectAnalysisConfig;
  status: ProjectStatus;
  progress?: JobProgress | null;
}

// ---- End multi-project types ----

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export type Mode = 'analysis' | 'context' | 'edit';

export type AIModel = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

export interface ProcessEvent {
  type: 'tool_call' | 'tool_result' | 'text_delta' | 'cost_info';
  tool?: string;
  input?: Record<string, unknown>;
  isError?: boolean;
  text?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface DiffChunk {
  type: 'unchanged' | 'insertion' | 'deletion';
  text: string;
  accepted?: boolean; // undefined = pending, true = accepted, false = rejected
}

export interface EditProposal {
  explanation: string;
  diffs: DiffChunk[];
  revisedText: string;
  originalText: string; // kept for reject/restore — Claude already edited the file on disk
}

export interface AnalysisResponse {
  type: 'analysis';
  response: string;
  sessionId?: string;
}

export interface ContextResponse {
  type: 'context';
  response: string;
  savedTo?: string;
  sessionId?: string;
}

export interface EditResponse {
  type: 'edit_proposal';
  explanation: string;
  diffs: DiffChunk[];
  revisedText: string;
  originalText: string;
  sessionId?: string;
}

export type ClaudeResponse = AnalysisResponse | ContextResponse | EditResponse;
