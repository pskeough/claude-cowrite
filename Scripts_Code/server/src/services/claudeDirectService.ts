/**
 * claudeDirectService — optimized edit mode using the Anthropic SDK directly.
 *
 * Replaces the current subprocess-based edit flow with a single SDK call that:
 *   1. Injects file content into the prompt (no Read tool needed)
 *   2. Uses a custom propose_edits tool so Claude returns deltas, not full text
 *   3. Caches the system prompt + editorial guidance (10× cheaper on repeated calls)
 *   4. Applies edits server-side and diffs for the UI
 *   5. Defaults to Sonnet (40% cheaper); Opus flag available for opt-in
 *
 * Expected gains vs current approach (rough estimates from benchmark):
 *   Latency:  10-30s → 2-6s    (no subprocess spawn + no agentic loop)
 *   Cost:     $0.15-0.50/edit → $0.01-0.05/edit (model + caching + single pass)
 *   Turns:    3-20 agentic turns → 1 API call
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import { EDITORIAL_DIR, BOOK_ROOT, PROJECT_ROOT, getEditorialDir } from '../config.js';
import { computeWordDiffAsync, type DiffChunk } from './diffService.js';
import { readFile as readProjectFile } from './fileService.js';
import { toRelativePath } from './promptBuilder.js';
import type { ProcessEvent } from './claudeService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectEditRequest {
  message: string;
  centerPaneFile: string;       // root-relative path
  bookRoot?: string;            // absolute path to project root; defaults to BOOK_ROOT
  bookTitle?: string;           // shown in system prompt; defaults to 'The Basilisk'
  model?: 'sonnet' | 'opus';   // defaults to sonnet
  stream?: boolean;              // whether to emit streaming events
}

export interface DirectEditResult {
  type: 'edit_proposal';
  explanation: string;
  diffs: DiffChunk[];
  revisedText: string;
  originalText: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_IDS = {
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-6',
} as const;

const PRICING = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-opus-4-6':   { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.50 },
} as const;

// ---------------------------------------------------------------------------
// propose_edits tool definition
//
// Claude calls this once with all its changes.
// We apply them server-side — no file writes by Claude, no disk diffing.
// Output tokens: just the tool call payload (changes only, not the full file).
// ---------------------------------------------------------------------------

const PROPOSE_EDITS_TOOL: Anthropic.Tool = {
  name: 'propose_edits',
  description: [
    'Submit all proposed editorial changes to the manuscript.',
    'Call this tool ONCE with every change bundled together.',
    'Each edit must quote the original text verbatim — it will be matched exactly.',
    'Keep edits targeted and surgical. Do not include unchanged text in "replacement".',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description: 'Brief editorial rationale (2-4 sentences). What did you change and why?',
      },
      edits: {
        type: 'array',
        description: 'All proposed text changes.',
        items: {
          type: 'object',
          properties: {
            original: {
              type: 'string',
              description: 'The exact text to replace, copied verbatim from the manuscript.',
            },
            replacement: {
              type: 'string',
              description: 'The revised text that should replace it.',
            },
          },
          required: ['original', 'replacement'],
        },
      },
    },
    required: ['explanation', 'edits'],
  },
};

// ---------------------------------------------------------------------------
// Cache layer — editorial guidance is static per session.
// We cache the loaded guidance string in memory so loadEditorialGuidance()
// only hits disk once per server process lifetime.
// ---------------------------------------------------------------------------

// Per-root guidance cache (root path → cached guidance string)
const guidanceCache = new Map<string, string>();

async function loadEditorialGuidance(bookRoot: string = BOOK_ROOT): Promise<string> {
  if (guidanceCache.has(bookRoot)) return guidanceCache.get(bookRoot)!;
  const editorialDir = getEditorialDir(
    bookRoot === BOOK_ROOT ? undefined : path.basename(path.dirname(bookRoot)) // best-effort projectId
  );
  // Use the absolute editorial dir derived from bookRoot
  const absEditorialDir = path.join(bookRoot, 'EditorialGuidance_Directions');
  try {
    const files = await fs.readdir(absEditorialDir);
    const parts: string[] = [];
    for (const f of files.sort()) {
      if (f.endsWith('.txt') || f.endsWith('.md')) {
        const content = await fs.readFile(path.join(absEditorialDir, f), 'utf-8');
        parts.push(`--- ${f} ---\n${content}`);
      }
    }
    const result = parts.length > 0 ? `\n\n## Editorial Guidance\n${parts.join('\n\n')}` : '';
    guidanceCache.set(bookRoot, result);
    return result;
  } catch {
    guidanceCache.set(bookRoot, '');
    return '';
  }
}

export function invalidateGuidanceCache(bookRoot?: string): void {
  if (bookRoot) guidanceCache.delete(bookRoot);
  else guidanceCache.clear();
}

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

function toProjectPath(bookRelativePath: string, bookRoot: string = BOOK_ROOT): string {
  return toRelativePath(bookRelativePath, bookRoot);
}

// ---------------------------------------------------------------------------
// Apply edits server-side
// ---------------------------------------------------------------------------

interface ProposeEditsInput {
  explanation: string;
  edits: Array<{ original: string; replacement: string }>;
}

interface ApplyResult {
  revised: string;
  applied: number;
  failed: string[];   // originals that didn't match
}

// Normalize typography so Claude's quoted text matches the file even when
// quote styles, dash styles, or whitespace differ slightly.
function normalizeForMatch(s: string): string {
  return s
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/—/g, '--')
    .replace(/…/g, '...')
    .replace(/\r\n/g, '\n')
    .replace(/  +/g, ' ')
    .trim();
}

function applyEdits(text: string, edits: ProposeEditsInput['edits']): ApplyResult {
  let revised = text;
  let applied = 0;
  const failed: string[] = [];

  for (const edit of edits) {
    if (!edit.original || edit.original === edit.replacement) continue;

    // 1. Exact verbatim match
    if (revised.includes(edit.original)) {
      revised = revised.replace(edit.original, edit.replacement);
      applied++;
      continue;
    }

    // 2. Trimmed match (whitespace drift)
    const trimmed = edit.original.trim();
    const trimIdx = revised.indexOf(trimmed);
    if (trimIdx !== -1) {
      revised = revised.slice(0, trimIdx) + edit.replacement + revised.slice(trimIdx + trimmed.length);
      applied++;
      continue;
    }

    // 3. Typography-normalized match (smart quotes, em-dashes, etc.)
    // Build a normalized version of the entire text and locate the match there,
    // then map back to the position in the original.
    const normText     = normalizeForMatch(revised);
    const normOriginal = normalizeForMatch(edit.original);
    const normIdx      = normText.indexOf(normOriginal);
    if (normIdx !== -1 && normOriginal.length > 0) {
      // Find the actual position in `revised` by scanning character-by-character.
      // normalizeForMatch can change char counts (-- vs —), so we need char mapping.
      let textPos = 0, normPos = 0;
      while (normPos < normIdx && textPos < revised.length) {
        const nc = normalizeForMatch(revised[textPos]);
        normPos += nc.length;
        textPos++;
      }
      // Find end of match span
      let endPos = textPos;
      let matchedNorm = 0;
      while (matchedNorm < normOriginal.length && endPos < revised.length) {
        const nc = normalizeForMatch(revised[endPos]);
        matchedNorm += nc.length;
        endPos++;
      }
      if (matchedNorm >= normOriginal.length) {
        revised = revised.slice(0, textPos) + edit.replacement + revised.slice(endPos);
        applied++;
        continue;
      }
    }

    failed.push(edit.original.slice(0, 80));
  }

  return { revised, applied, failed };
}

// ---------------------------------------------------------------------------
// Cost calculator
// ---------------------------------------------------------------------------

function calcCost(
  modelId: string,
  input: number,
  output: number,
  cacheWrite: number,
  cacheRead: number,
): number {
  const p = PRICING[modelId as keyof typeof PRICING];
  if (!p) return 0;
  return (
    (input      * p.input      / 1_000_000) +
    (output     * p.output     / 1_000_000) +
    (cacheWrite * p.cacheWrite / 1_000_000) +
    (cacheRead  * p.cacheRead  / 1_000_000)
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runDirectEdit(
  request: DirectEditRequest,
  onEvent?: (event: ProcessEvent) => void,
): Promise<DirectEditResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });
  const modelKey = request.model ?? 'sonnet';
  const modelId = MODEL_IDS[modelKey];
  const start = Date.now();
  const effectiveRoot = request.bookRoot ?? BOOK_ROOT;
  const bookTitle = request.bookTitle ?? 'The Basilisk';

  // --- Load file content ---
  const originalText = await readProjectFile(request.centerPaneFile, effectiveRoot);
  const projectPath  = toProjectPath(request.centerPaneFile, effectiveRoot);
  const guidance     = await loadEditorialGuidance(effectiveRoot);

  // --- Build system prompt with cache_control ---
  // This block is static across edit requests — it will be cached after the first call.
  // cache_control: ephemeral means it stays cached for up to 5 minutes.
  const systemText = [
    `You are a literary editor for "${bookTitle}". You are in EDIT mode.`,
    ``,
    `Your task:`,
    `- Read the chapter provided in the user message`,
    `- Apply the author's editing instruction`,
    `- Call the propose_edits tool ONCE with all your changes`,
    ``,
    `Rules:`,
    `- Make targeted, surgical edits — do not rewrite wholesale`,
    `- Preserve the author's voice and sentence rhythm`,
    `- Quote original text VERBATIM in each edit's "original" field`,
    `- Do NOT call propose_edits more than once`,
    guidance,
  ].join('\n');

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: systemText,
      cache_control: { type: 'ephemeral' },
    },
  ];

  // --- Build user message ---
  // Two content blocks: the editing instruction (smallish, not cached) and
  // the chapter text (large, not cached — changes per file).
  const userContent: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `## File: ${projectPath}\n\n## Editing Instruction\n${request.message}`,
    },
    {
      type: 'text',
      text: `## Chapter Text\n\n${originalText}`,
    },
  ];

  onEvent?.({ type: 'text_delta', text: '' }); // signal start to UI

  // --- API call ---
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    system: systemBlocks,
    tools: [PROPOSE_EDITS_TOOL],
    tool_choice: { type: 'any' }, // force Claude to call propose_edits
    messages: [{ role: 'user', content: userContent }],
  });

  const latencyMs = Date.now() - start;

  // --- Extract usage ---
  const inputTokens  = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cacheWriteTokens: number = (response.usage as any).cache_creation_input_tokens ?? 0;
  const cacheReadTokens:  number = (response.usage as any).cache_read_input_tokens      ?? 0;
  const estimatedCostUsd = calcCost(modelId, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens);

  console.log(
    `[direct-edit] model=${modelId} latency=${latencyMs}ms ` +
    `in=${inputTokens} out=${outputTokens} ` +
    `cache_write=${cacheWriteTokens} cache_read=${cacheReadTokens} ` +
    `cost=$${estimatedCostUsd.toFixed(4)}`
  );

  onEvent?.({
    type: 'cost_info',
    costUsd: estimatedCostUsd,
    durationMs: latencyMs,
    numTurns: 1,
  });

  // --- Extract tool call ---
  const toolUse = response.content.find(b => b.type === 'tool_use') as
    | (Anthropic.ToolUseBlock & { input: ProposeEditsInput })
    | undefined;

  if (!toolUse?.input) {
    // Claude returned text instead of calling the tool — treat as no-op
    const textResponse = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('');
    console.warn(`[direct-edit] Claude did not call propose_edits. Response: ${textResponse.slice(0, 200)}`);
    throw new Error(`Claude did not propose any edits. It responded: "${textResponse.slice(0, 200)}"`);
  }

  const { explanation, edits } = toolUse.input;
  const { revised: revisedText, applied, failed } = applyEdits(originalText, edits ?? []);

  if (failed.length > 0) {
    console.warn(`[direct-edit] ${failed.length} edit(s) failed to match: ${failed.join(' | ')}`);
  }

  onEvent?.({ type: 'text_delta', text: explanation });

  const diffs = await computeWordDiffAsync(originalText, revisedText);

  return {
    type: 'edit_proposal',
    explanation,
    diffs,
    revisedText,
    originalText,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    estimatedCostUsd,
    latencyMs,
  };
}
