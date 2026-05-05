import { spawn } from 'child_process';
import { buildSystemPrompt, buildUserMessage, type Mode, type HistoryMessage } from './promptBuilder.js';
import { computeWordDiff, type DiffChunk } from './diffService.js';
import { PROJECT_ROOT } from '../config.js';

interface GeminiRequest {
  mode: Mode;
  message: string;
  centerPaneContent?: string;
  centerPaneFile?: string;
  leftPaneContent?: string;
  leftPaneFile?: string;
  history?: HistoryMessage[];
  model?: string;
}

interface AnalysisResponse {
  type: 'analysis';
  response: string;
}

interface ContextResponse {
  type: 'context';
  response: string;
  fileName?: string;
  fileContent?: string;
}

interface EditResponse {
  type: 'edit_proposal';
  explanation: string;
  diffs: DiffChunk[];
  revisedText: string;
}

export type GeminiResponse = AnalysisResponse | ContextResponse | EditResponse;

function getModelForMode(mode: Mode): string {
  return mode === 'edit' ? 'gemini-2.5-pro' : 'gemini-2.5-pro';
}

export interface ProcessEvent {
  type: 'tool_call' | 'tool_result' | 'text_delta';
  tool?: string;
  input?: Record<string, unknown>;
  isError?: boolean;
  text?: string;
}

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  model: string,
  onEvent?: (event: ProcessEvent) => void,
  signal?: AbortSignal,
): Promise<string> {
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

  const activeToolCalls: Record<string, string> = {};
  let lastTextLength = 0;

  return new Promise((resolve, reject) => {
    console.log(`[gemini] Spawning: model=${model}, prompt length=${fullPrompt.length} chars`);

    const proc = spawn('gemini', [
      '--output-format', 'stream-json',
      '--model', model,
    ], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    let lineBuffer = '';
    let finalResult = '';
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
            console.log(`[gemini] Event #${eventCount}: type=${ev.type}${ev.subtype ? ` subtype=${ev.subtype}` : ''}`);
          }

          // Support Claude-like "assistant" blocks (if Gemini CLI perfectly mimics Claude Code format)
          if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
            for (const block of ev.message.content) {
              if (block.type === 'tool_use' && onEvent) {
                activeToolCalls[block.id] = block.name;
                console.log(`[gemini] Tool call: ${block.name}`);
                onEvent({ type: 'tool_call', tool: block.name, input: block.input ?? {} });
              } else if (block.type === 'text' && block.text && onEvent) {
                const newText = block.text.slice(lastTextLength);
                if (newText) {
                  onEvent({ type: 'text_delta', text: newText });
                  lastTextLength = block.text.length;
                }
              }
            }
          }

          // Support specific Gemini CLI event formats (e.g. type='message' or type='tool_use')
          if (ev.type === 'message' && ev.message?.content && Array.isArray(ev.message.content)) {
            for (const block of ev.message.content) {
                if (block.type === 'text' && block.text && onEvent) {
                    const newText = block.text.slice(lastTextLength);
                    if (newText) {
                        onEvent({ type: 'text_delta', text: newText });
                        lastTextLength = block.text.length;
                    }
                }
            }
          }

          if (ev.type === 'content_block_delta' && ev.delta?.text && onEvent) {
            onEvent({ type: 'text_delta', text: ev.delta.text });
          }

          if (ev.type === 'tool' && onEvent) {
            const toolName = activeToolCalls[ev.tool_use_id] ?? 'tool';
            console.log(`[gemini] Tool result: ${toolName} (error=${!!ev.is_error})`);
            onEvent({ type: 'tool_result', tool: toolName, isError: !!ev.is_error });
          }

          if (ev.type === 'result' && ev.result) {
            finalResult = ev.result;
            console.log(`[gemini] Got final result: ${finalResult.length} chars`);
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
        console.log(`[gemini] stderr: ${chunk.trim().slice(0, 200)}`);
      }
    });

    proc.on('close', (code) => {
      console.log(`[gemini] Process exited: code=${code}, events=${eventCount}, result=${finalResult.length} chars`);
      if (code !== 0) {
        console.error(`[gemini] ERROR stderr:\n${stderr}`);
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(finalResult || stderr);
    });

    proc.on('error', (err) => {
      console.error(`[gemini] Spawn error: ${err.message}`);
      reject(new Error(`Failed to spawn Gemini CLI: ${err.message}. Is gemini CLI installed?`));
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        console.log('[gemini] Abort signal received — killing subprocess');
        proc.kill();
      });
    }
  });
}

export async function sendToGemini(
  request: GeminiRequest,
  onEvent?: (event: ProcessEvent) => void,
  signal?: AbortSignal,
): Promise<GeminiResponse> {
  const systemPrompt = await buildSystemPrompt(request.mode);
  const userMessage = buildUserMessage(
    request.message,
    request.centerPaneContent,
    request.centerPaneFile,
    request.leftPaneContent,
    request.leftPaneFile,
    request.history,
  );
  const model = request.model || getModelForMode(request.mode);

  const rawResponse = await callGemini(systemPrompt, userMessage, model, onEvent, signal);

  function extractJson(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return fenced ? fenced[1].trim() : text.trim();
  }

  if (request.mode === 'edit' && request.centerPaneContent) {
    try {
      const parsed = JSON.parse(extractJson(rawResponse));
      if (parsed.revisedText) {
        const diffs = computeWordDiff(request.centerPaneContent, parsed.revisedText);
        return {
          type: 'edit_proposal',
          explanation: parsed.explanation || 'Proposed edits',
          diffs,
          revisedText: parsed.revisedText,
        };
      }
    } catch {
      return { type: 'analysis', response: rawResponse };
    }
  }

  if (request.mode === 'context') {
    try {
      const parsed = JSON.parse(extractJson(rawResponse));
      if (parsed.fileName && parsed.fileContent) {
        return { type: 'context', response: parsed.summary || rawResponse, fileName: parsed.fileName, fileContent: parsed.fileContent };
      }
    } catch {
      // Plain text context response
    }
    return { type: 'context', response: rawResponse };
  }

  return { type: 'analysis', response: rawResponse };
}
