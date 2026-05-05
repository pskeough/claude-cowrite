import { spawn } from 'child_process';
import {
  MODE_SYSTEM_PROMPTS,
  buildContextualMessage,
  type Mode,
  type HistoryMessage,
} from './promptBuilder.js';
import { computeWordDiff, type DiffChunk } from './diffService.js';
import { readFile as readProjectFile } from './fileService.js';
import { PROJECT_ROOT } from '../config.js';

export interface ClaudeRequest {
  mode: Mode;
  message: string;
  centerPaneFile?: string;
  leftPaneFile?: string;
  history?: HistoryMessage[];
  model?: string;
  sessionId?: string; // --resume an existing session
}

interface AnalysisResponse {
  type: 'analysis';
  response: string;
  sessionId?: string;
}

interface ContextResponse {
  type: 'context';
  response: string;
  fileName?: string;
  fileContent?: string;
  sessionId?: string;
}

interface EditResponse {
  type: 'edit_proposal';
  explanation: string;
  diffs: DiffChunk[];
  revisedText: string;
  originalText: string; // saved for reject/restore
  sessionId?: string;
}

export type ClaudeResponse = AnalysisResponse | ContextResponse | EditResponse;

function getModelForMode(mode: Mode): string {
  return mode === 'edit' ? 'claude-opus-4-6' : 'claude-sonnet-4-6';
}

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

// Tools available per mode — restricts Claude to only the operations it needs
const MODE_ALLOWED_TOOLS: Record<Mode, string> = {
  analysis: 'Read,Glob,Grep,LS',             // read-only: never modifies files
  context:  'Read,Glob,Grep,Write,Edit,LS',   // can create/update context documents
  edit:     'Read,Edit,LS',                   // targeted edits only — no new file creation
};

// Max agentic tool-call loops per mode
const MODE_MAX_TURNS: Record<Mode, number> = {
  analysis: 15,  // research can need several file reads
  context:  10,  // read then write
  edit:     20,  // read + multiple targeted edits + verify — needs headroom
};

interface CallResult {
  text: string;
  sessionId: string;
}

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  model: string,
  mode: Mode,
  onEvent?: (event: ProcessEvent) => void,
  signal?: AbortSignal,
  resumeSessionId?: string,
): Promise<CallResult> {
  // Track active tool calls by id so we can match results
  const activeToolCalls: Record<string, string> = {};
  // Track cumulative text length to emit only deltas from assistant snapshot events
  let lastTextLength = 0;
  // Track how many chars have already been streamed via content_block_delta
  let streamedLength = 0;

  return new Promise((resolve, reject) => {
    const totalInputLength = systemPrompt.length + userMessage.length;
    console.log(`[claude] Spawning: model=${model}, mode=${mode}, resume=${resumeSessionId ?? 'new'}, input=${totalInputLength} chars`);

    // --system-prompt: mode-specific instructions (short, safe as CLI arg)
    // --include-partial-messages: enables true incremental text streaming (content_block_delta events)
    // --allowedTools: restricts Claude to only the tools appropriate for this mode
    // --max-turns: prevents runaway agentic loops
    // --resume: continues an existing session (Claude manages its own context natively)
    const args: string[] = [
      '--output-format', 'stream-json',
      '--verbose',
      '--model', model,
      '--dangerously-skip-permissions',
      '--system-prompt', systemPrompt,
      '--include-partial-messages',
      '--allowedTools', MODE_ALLOWED_TOOLS[mode],
      '--max-turns', String(MODE_MAX_TURNS[mode]),
    ];

    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    // Edit mode is stateless (file-diff per request) — don't persist a session file
    if (mode === 'edit') {
      args.push('--no-session-persistence');
    }

    args.push('-p', '');

    const proc = spawn('claude', args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      windowsHide: true,
    });

    // Write user message to stdin and close immediately
    proc.stdin.write(userMessage);
    proc.stdin.end();

    let lineBuffer = '';
    let finalResult = '';
    let sessionId = '';
    let stderr = '';
    let eventCount = 0;

    proc.stdout.on('data', (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          eventCount++;

          if (eventCount <= 20 || eventCount % 10 === 0) {
            console.log(`[claude] Event #${eventCount}: type=${ev.type}${ev.subtype ? ` subtype=${ev.subtype}` : ''}`);
          }

          // Extract session ID from any event that carries it
          if (ev.session_id && !sessionId) {
            sessionId = ev.session_id;
          }

          // Tool calls and text from assistant events (cumulative snapshots)
          if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
            for (const block of ev.message.content) {
              if (block.type === 'tool_use' && onEvent) {
                activeToolCalls[block.id] = block.name;
                console.log(`[claude] Tool call: ${block.name}`);
                onEvent({ type: 'tool_call', tool: block.name, input: block.input ?? {} });
              } else if (block.type === 'text' && block.text && onEvent) {
                // Assistant events are cumulative snapshots — only emit what's new
                const alreadySent = Math.max(lastTextLength, streamedLength);
                const newText = block.text.slice(alreadySent);
                if (newText) {
                  onEvent({ type: 'text_delta', text: newText });
                }
                lastTextLength = block.text.length;
              }
            }
          }

          // content_block_delta — true incremental streaming chunks
          if (ev.type === 'content_block_delta' && ev.delta?.text && onEvent) {
            onEvent({ type: 'text_delta', text: ev.delta.text });
            streamedLength += ev.delta.text.length;
          }

          // Tool result
          if (ev.type === 'tool' && onEvent) {
            const toolName = activeToolCalls[ev.tool_use_id] ?? 'tool';
            console.log(`[claude] Tool result: ${toolName} (error=${!!ev.is_error})`);
            onEvent({ type: 'tool_result', tool: toolName, isError: !!ev.is_error });
          }

          // Final result — captures session_id, cost, and duration
          if (ev.type === 'result') {
            if (ev.result) finalResult = ev.result;
            if (ev.session_id) sessionId = ev.session_id;
            console.log(`[claude] Result: ${finalResult.length} chars, session=${sessionId}, cost=$${ev.total_cost_usd?.toFixed(4) ?? '?'}, turns=${ev.num_turns ?? '?'}, ms=${ev.duration_ms ?? '?'}`);
            if (onEvent && (ev.total_cost_usd != null || ev.duration_ms != null)) {
              onEvent({
                type: 'cost_info',
                costUsd: ev.total_cost_usd,
                durationMs: ev.duration_ms,
                numTurns: ev.num_turns,
              });
            }
          }
        } catch {
          // Non-JSON line, skip
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (chunk.trim()) {
        console.log(`[claude] stderr: ${chunk.trim().slice(0, 200)}`);
      }
    });

    proc.on('close', (code) => {
      console.log(`[claude] Process exited: code=${code}, events=${eventCount}`);
      if (code !== 0) {
        console.error(`[claude] ERROR:\n${stderr}`);
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve({ text: finalResult || stderr, sessionId });
    });

    proc.on('error', (err) => {
      console.error(`[claude] Spawn error: ${err.message}`);
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}. Is claude CLI installed?`));
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        console.log('[claude] Abort signal — killing subprocess');
        proc.kill();
      });
    }
  });
}

export async function sendToClaude(
  request: ClaudeRequest,
  onEvent?: (event: ProcessEvent) => void,
  signal?: AbortSignal,
): Promise<ClaudeResponse> {
  const model = request.model || getModelForMode(request.mode);
  const systemPrompt = MODE_SYSTEM_PROMPTS[request.mode];

  // --- EDIT MODE: file-diff approach ---
  // Claude reads the file via its Read tool, edits via its Edit tool.
  // We diff the file state before/after. No JSON output required.
  if (request.mode === 'edit') {
    if (!request.centerPaneFile) {
      return { type: 'analysis', response: 'No file is open in the center pane. Open a file to edit.' };
    }

    // Snapshot the file before Claude touches it (for reject/restore)
    const originalText = await readProjectFile(request.centerPaneFile);

    const userMessage = await buildContextualMessage(
      request.message,
      'edit',
      request.centerPaneFile,
      request.leftPaneFile,
      request.history,
      true, // always include project context for edit (stateless, no session)
    );

    // Edit sessions are stateless — each edit starts fresh so Claude reads the
    // current file state. No --resume here.
    // Note: Claude CLI may exit with code 1 when it hits --max-turns even after
    // successfully writing all edits to disk. We catch that error and still
    // proceed to diff the file below.
    let explanation = '';
    let sessionId = '';
    try {
      const result = await callClaude(
        systemPrompt,
        userMessage,
        model,
        'edit',
        onEvent,
        signal,
        undefined, // no resume for edit
      );
      explanation = result.text;
      sessionId = result.sessionId;
    } catch (err: any) {
      // Non-fatal in edit mode — edits may already be written to disk.
      // Fall through to the diff check below.
      console.warn(`[claude] Edit mode exited non-zero — still checking file diff. Error: ${err.message?.slice(0, 200)}`);
    }

    // Read the file after Claude's Edit tool ran
    let revisedText: string;
    try {
      revisedText = await readProjectFile(request.centerPaneFile);
    } catch {
      revisedText = originalText;
    }

    if (revisedText !== originalText) {
      const diffs = computeWordDiff(originalText, revisedText);
      return {
        type: 'edit_proposal',
        explanation: explanation || 'Edits applied.',
        diffs,
        revisedText,
        originalText,
        sessionId,
      };
    } else {
      // Claude didn't edit the file — return explanation as analysis so the user can see why
      return {
        type: 'analysis',
        response: explanation || 'Claude did not make any changes to the file.',
        sessionId,
      };
    }
  }

  // --- ANALYSIS / CONTEXT MODE: session-based ---
  // Use --resume to continue the session, Claude maintains its own context.
  // isFirstTurn = no session yet (need to pass project context)
  const isFirstTurn = !request.sessionId;

  const userMessage = await buildContextualMessage(
    request.message,
    request.mode,
    request.centerPaneFile,
    request.leftPaneFile,
    isFirstTurn ? [] : (request.history ?? []), // history only needed on first turn (no resume yet) or for stateless
    isFirstTurn,
  );

  const { text: rawResponse, sessionId } = await callClaude(
    systemPrompt,
    userMessage,
    model,
    request.mode,
    onEvent,
    signal,
    request.sessionId, // --resume if we have a session
  );

  if (request.mode === 'context') {
    // Claude uses its Write tool directly to create files in AI_Analysis_Output/.
    // No JSON parsing needed — just return the plain text summary.
    return { type: 'context', response: rawResponse, sessionId };
  }

  return { type: 'analysis', response: rawResponse, sessionId };
}
