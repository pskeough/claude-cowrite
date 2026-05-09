export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export type Mode = 'analysis' | 'context' | 'edit';

export type AIProvider = 'claude' | 'gemini';

export type ClaudeModel = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';
export type GeminiModel = 'gemini-2.5-pro' | 'gemini-3-flash-preview' | 'gemini-3.1-flash-lite-preview';
export type AIModel = ClaudeModel | GeminiModel;

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

export interface AnalysisEvent {
  type:
    | 'pipeline_start' | 'pipeline_done'
    | 'analysis_type_start' | 'analysis_type_done'
    | 'chunk_start' | 'chunk_done'
    | 'tool_call' | 'tool_result' | 'text_delta' | 'cost_info'
    | 'error';
  // pipeline_start
  totalChunks?: number;
  analysisTypes?: string[];
  // chunk/type tracking
  analysisType?: string;
  chunkIndex?: number;
  totalChunksForType?: number;
  // tool events
  tool?: string;
  input?: Record<string, unknown>;
  isError?: boolean;
  text?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  // error
  error?: string;
  recoverable?: boolean;
}

export interface PipelineStatus {
  runId: string;
  startedAt: string;
  manuscriptPath: string;
  totalChunks: number;
  model: string;
  completedTypes: string[];
  status: 'running' | 'complete' | 'cancelled' | 'error';
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
