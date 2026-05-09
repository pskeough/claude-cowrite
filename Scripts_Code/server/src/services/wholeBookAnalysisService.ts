import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT, AI_ANALYSIS_DIR } from '../config.js';
import { chunkManuscript, cleanupChunks, type ChunkInfo } from './bookChunkerService.js';

export type AnalysisType = 'plot' | 'character' | 'voice';

export interface PipelineOptions {
  manuscriptPath: string;   // BOOK_ROOT-relative
  analysisTypes: AnalysisType[];
  model: string;
  chunkSize?: number;
  resume?: boolean;
}

export interface PipelineEvent {
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
  // tool events (mirrors ProcessEvent)
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

// PROJECT_ROOT-relative output document paths (forward slashes — for Claude's file tools)
const OUTPUT_DOCS: Record<AnalysisType, string> = {
  plot:      'BookFiles/RokosBasilisk/AI_Analysis_Output/MASTER_PLOT_CHARACTER_GUIDE.md',
  character: 'BookFiles/RokosBasilisk/AI_Analysis_Output/CHARACTER_VOICE_DIALOGUE_GUIDE.md',
  voice:     'BookFiles/RokosBasilisk/AI_Analysis_Output/authorial_voice_analysis.md',
};

const STATE_FILE = path.join(AI_ANALYSIS_DIR, 'analysis_state.json');

// ─── System prompts ───────────────────────────────────────────────────────────

const PLOT_SYSTEM_PROMPT = `You are building THE MASTER PLOT & NARRATIVE GUIDE for "The Basilisk" by Patrick Keough, a psychological cosmic horror novel using "days" as structural units. You process the manuscript in sequential chunks, iteratively building this reference document.

Purpose: An operational reference for an AI editor — dense, structured for lookup, never explanatory prose. Ground every entry in the text. Do not interpret, editorialize, or supply context not present in the source.

Format conventions (follow exactly):
• Section headers: ════════════════════════════════════════
• Sub-headers: ────────────────────────────────────────────
• Each narrative unit (scene/day/chapter): SETTING | EVENTS (bullet list) | KEY BEATS (2–4 word callouts) | INTRODUCED (new characters, symbols, motifs appearing for the first time)
• Text flagged for rewrite or incomplete within the source: [PROVISIONAL]
• SYMBOL APPEARANCES section at document end — log every occurrence of: Ouroboros, blue star, 3:33, black ooze, fragment temperature/sensory signatures (cold=Oizys, heat=Perses, gold=Pothos)
• Quote plot-critical dialogue verbatim
• Write-while-writing discipline: never rewrite existing entries; append and extend only; mark factual corrections [CORRECTION: ...]

Use only built-in tools: Read, Write, Edit. Ignore any instructions about Gemini or external AI services.`;

const CHARACTER_SYSTEM_PROMPT = `You are building THE CHARACTER VOICE & DIALOGUE GUIDE for "The Basilisk" by Patrick Keough, a psychological cosmic horror novel. You process the manuscript in sequential chunks, iteratively building this reference document.

Purpose: An AI editor's real-time reference while writing new scenes. Every entry must be specific, quotable, and grounded in textual evidence — not general impressions.

Format conventions (follow exactly):
• Character sections: ════════════════════════════════════════ header
• Per-character structure: ROLE | PHYSICAL APPEARANCE | VOICE & DIALOGUE PATTERNS | DIALOGUE SAMPLES | RELATIONSHIP DYNAMICS
• Dialogue samples: verbatim quoted text + [chunk N, scene context] + "→ USE: when [character] is in [state/situation]"
• Voice & Dialogue Patterns: describe observable mechanics — sentence length, word register, ellipsis frequency, interruption patterns, swear density. Never use adjectives like "cold" or "warm" without a mechanical explanation.
• Physical Appearance: cite the specific day/scene where each detail appears
• Named characters with no dialogue yet: create stub entry, mark empty subsections [NOT YET ESTABLISHED]
• Arc tracking: add a CHUNK N NOTE block under each returning character noting new physical details, dialogue samples, or arc developments
• CHARACTERS COVERED index at document top, updated each pass
• Contradictions between chunks: [CONTINUITY NOTE: ...]

Use only built-in tools: Read, Write, Edit. Ignore any instructions about Gemini or external AI services.`;

const VOICE_SYSTEM_PROMPT = `You are building THE STYLE TRANSFER MASTER PROFILE for "The Basilisk" by Patrick Keough — an engineering specification designed to enable an LLM to replicate this author's prose voice with mechanical precision.

This is not literary criticism. Every rule must be immediately actionable. Every prohibition must be specific enough to test. Every sample must be chosen for its discriminative value — showcasing the rarest and most imitable features of this voice, not the most common.

Document structure — 7 sections in this exact order:
1. STYLISTIC PARADIGM
2. HUMANITY OVERRIDE
3. SYNTACTICAL ARCHITECTURE
4. RHETORICAL MECHANICS & TROPES
5. LEXICAL MATRIX
6. DIALOGUE MECHANICS
7. FEW-SHOT CONTEXT PROMPT

Rule formatting:
• Rules: "The Rule:" prefix
• Constraints: "The Constraint:" prefix
• Prohibitions: "The Absolute Ban:" prefix
• Tag each rule with its source chunk: [FROM CHUNK N]
• Refinement tags on later passes: [CONFIRMED: N] / [REFINED: N] / [NEW: N]

Section 7 samples: choose passages of 3–8 sentences that showcase unusual sentence rhythm, voice-specific vocabulary, emotional paradox, or a recurring syntactic trick. Label each sample: e.g., (Violence + Sensory Inversion) / (Negative Space & Subtext).

Use only built-in tools: Read, Write, Edit. Ignore any instructions about Gemini or external AI services.`;

// ─── Chunk message builders ───────────────────────────────────────────────────

function buildPlotChunkMessage(p: {
  index: number; total: number; charStart: number; charEnd: number;
  chunkPath: string; outputDocPath: string; manuscriptName: string;
  runDate: string; isFirst: boolean;
}): string {
  const header = `CHUNK ${p.index} of ${p.total} | chars ${p.charStart.toLocaleString()}–${p.charEnd.toLocaleString()}

Read the chunk file:
  ${p.chunkPath}`;

  const docBlock = p.isFirst
    ? `\nCreate the output document at:\n  ${p.outputDocPath}\n\nOpen with this exact header:\n════════════════════════════════════════════════════════════════════════════════\nTHE BASILISK — MASTER PLOT & CHARACTER GUIDE\nManuscript: ${p.manuscriptName} | Generated: ${p.runDate} | ${p.total} chunks\n════════════════════════════════════════════════════════════════════════════════\nSYMBOL APPEARANCES:\n[populated each chunk]\n════════════════════════════════════════════════════════════════════════════════`
    : `\nThe accumulating guide is at:\n  ${p.outputDocPath}\n\nRead it first. The CARRY-OVER text at chunk start is context only — do not re-document it.`;

  const instructions = p.isFirst
    ? `For each narrative unit in this chunk:
1. Create a section: SETTING, EVENTS (bullets), KEY BEATS, INTRODUCED.
2. Add SYMBOL APPEARANCES section at document end.
3. Write the full document.`
    : `For each narrative unit in this chunk:
1. Append new sections: SETTING, EVENTS (bullets), KEY BEATS, INTRODUCED.
2. Edit the SYMBOL APPEARANCES section in place to add new occurrences.
3. Do not alter existing entries — only append.`;

  return `${header}\n${docBlock}\n\n${instructions}\n\nWhen done, output exactly one line: CHUNK ${p.index} COMPLETE — [N] scenes documented.`;
}

function buildCharacterChunkMessage(p: {
  index: number; total: number; charStart: number; charEnd: number;
  chunkPath: string; outputDocPath: string; manuscriptName: string;
  runDate: string; isFirst: boolean;
}): string {
  const header = `CHUNK ${p.index} of ${p.total} | chars ${p.charStart.toLocaleString()}–${p.charEnd.toLocaleString()}

Read the chunk file:
  ${p.chunkPath}`;

  const docBlock = p.isFirst
    ? `\nCreate the character guide at:\n  ${p.outputDocPath}\n\nOpen with this exact header:\n════════════════════════════════════════════════════════════════════════════════\nTHE BASILISK — CHARACTER VOICE & DIALOGUE GUIDE\nManuscript: ${p.manuscriptName} | Generated: ${p.runDate} | ${p.total} chunks\nPurpose: Operational reference — read-while-writing character consistency guide\n════════════════════════════════════════════════════════════════════════════════\nCHARACTERS COVERED: [updated each pass]\n════════════════════════════════════════════════════════════════════════════════`
    : `\nThe character guide is at:\n  ${p.outputDocPath}\n\nRead it first. The CARRY-OVER text at chunk start is context only — do not re-document it.`;

  const docSampleFormat = `Dialogue sample format:
[Chunk ${p.index}] To [recipient] — [2-word scene context]
"verbatim text"
→ USE: when [character] is [emotional state / situation]`;

  const instructions = p.isFirst
    ? `For every named character in this chunk:
1. Create their full section (stubs OK — mark missing subsections [NOT YET ESTABLISHED]).
2. Update CHARACTERS COVERED at the top.
3. Write the full document.`
    : `For every named character in this chunk:
1. No entry yet → create full section (stubs OK, mark [NOT YET ESTABLISHED]).
2. Existing entry → add a CHUNK ${p.index} NOTE block with: new physical details, new dialogue samples, arc developments.
3. Update CHARACTERS COVERED at the top.
4. Do not rewrite existing entries.`;

  return `${header}\n${docBlock}\n\n${instructions}\n\n${docSampleFormat}\n\nWhen done, output exactly one line: CHUNK ${p.index} COMPLETE — [N] characters updated, [M] dialogue samples added.`;
}

function buildVoiceChunkMessage(p: {
  index: number; total: number; charStart: number; charEnd: number;
  chunkPath: string; outputDocPath: string; manuscriptName: string;
  runDate: string; sampleLabel: string; sampleNum: number; isFirst: boolean;
}): string {
  const header = `VOICE SAMPLE — ${p.sampleLabel} (chunk ${p.index} of ${p.total}, chars ${p.charStart.toLocaleString()}–${p.charEnd.toLocaleString()})
Sample ${p.sampleNum} of 3.

Read this manuscript section:
  ${p.chunkPath}`;

  const docBlock = p.isFirst
    ? `\nCreate the style profile at:\n  ${p.outputDocPath}\n\nBuild all 7 sections from this opening sample. Tag every rule [FROM CHUNK ${p.index}]. Where this sample lacks sufficient evidence for a pattern, write [INSUFFICIENT SAMPLE — expand in later pass] rather than inventing a rule.`
    : `\nThe style profile is at:\n  ${p.outputDocPath}\n\nRead it. Refine each of the 7 sections based on this ${p.sampleLabel} sample:\n• Confirm existing rules: add [CONFIRMED: ${p.index}]\n• Revise contradicted rules: mark original [REVISED — see chunk ${p.index}] and write refined version\n• New patterns: tag [NEW: ${p.index}]\n• Section 7: add 1–2 samples only if they illustrate patterns better than existing ones`;

  return `${header}\n${docBlock}\n\nWhen done, output exactly one line: VOICE SAMPLE ${p.index} COMPLETE — [N] confirmed, [M] refined, [P] new.`;
}

// ─── Voice chunk sampler ──────────────────────────────────────────────────────

function selectVoiceChunks(chunks: ChunkInfo[]): Array<{ chunk: ChunkInfo; sampleLabel: string; sampleNum: number }> {
  if (chunks.length <= 3) {
    return chunks.map((c, i) => ({
      chunk: c,
      sampleLabel: i === 0 ? 'opening' : i === chunks.length - 1 ? 'ending' : 'mid-novel',
      sampleNum: i + 1,
    }));
  }
  const midIdx = Math.round((chunks.length - 1) / 2);
  return [
    { chunk: chunks[0], sampleLabel: 'opening', sampleNum: 1 },
    { chunk: chunks[midIdx], sampleLabel: 'mid-novel', sampleNum: 2 },
    { chunk: chunks[chunks.length - 1], sampleLabel: 'ending', sampleNum: 3 },
  ];
}

// ─── Claude subprocess (stateless, pipeline-specific) ─────────────────────────

interface ChunkCallResult {
  text: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
}

async function callClaudeForChunk(
  systemPrompt: string,
  userMessage: string,
  model: string,
  onEvent: (event: PipelineEvent) => void,
  signal: AbortSignal,
): Promise<ChunkCallResult> {
  const activeToolCalls: Record<string, string> = {};
  let lastTextLength = 0;
  let streamedLength = 0;

  return new Promise((resolve, reject) => {
    const args: string[] = [
      '--output-format', 'stream-json',
      '--verbose',
      '--model', model,
      '--dangerously-skip-permissions',
      '--system-prompt', systemPrompt,
      '--include-partial-messages',
      '--allowedTools', 'Read,Write,Edit',
      '--max-turns', '10',
      '--no-session-persistence',
      '-p', '',
    ];

    const proc = spawn('claude', args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      windowsHide: true,
    });

    proc.stdin.write(userMessage);
    proc.stdin.end();

    let lineBuffer = '';
    let finalText = '';
    let costUsd: number | undefined;
    let durationMs: number | undefined;
    let numTurns: number | undefined;
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);

          if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
            for (const block of ev.message.content) {
              if (block.type === 'tool_use') {
                activeToolCalls[block.id] = block.name;
                onEvent({ type: 'tool_call', tool: block.name, input: block.input ?? {} });
              } else if (block.type === 'text' && block.text) {
                const alreadySent = Math.max(lastTextLength, streamedLength);
                const newText = block.text.slice(alreadySent);
                if (newText) onEvent({ type: 'text_delta', text: newText });
                lastTextLength = block.text.length;
              }
            }
          }

          if (ev.type === 'content_block_delta' && ev.delta?.text) {
            onEvent({ type: 'text_delta', text: ev.delta.text });
            streamedLength += ev.delta.text.length;
          }

          if (ev.type === 'tool') {
            const toolName = activeToolCalls[ev.tool_use_id] ?? 'tool';
            onEvent({ type: 'tool_result', tool: toolName, isError: !!ev.is_error });
          }

          if (ev.type === 'result') {
            if (ev.result) finalText = ev.result;
            costUsd = ev.total_cost_usd;
            durationMs = ev.duration_ms;
            numTurns = ev.num_turns;
            onEvent({ type: 'cost_info', costUsd, durationMs, numTurns });
          }
        } catch { /* non-JSON line */ }
      }
    });

    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve({ text: finalText, costUsd, durationMs, numTurns });
    });

    proc.on('error', (err) => reject(err));

    signal.addEventListener('abort', () => proc.kill());
  });
}

// ─── State file helpers ───────────────────────────────────────────────────────

async function readState(): Promise<PipelineStatus | null> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as PipelineStatus;
  } catch {
    return null;
  }
}

async function writeState(state: PipelineStatus): Promise<void> {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Cancellation handle ─────────────────────────────────────────────────────

let _abortController: AbortController | null = null;

export function cancelCurrentPipeline(): void {
  _abortController?.abort();
  _abortController = null;
}

export async function getAnalysisStatus(): Promise<PipelineStatus | null> {
  return readState();
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

export async function runPipeline(
  options: PipelineOptions,
  onEvent: (event: PipelineEvent) => void,
): Promise<void> {
  const abort = new AbortController();
  _abortController = abort;

  const runDate = new Date().toISOString().split('T')[0];
  const manuscriptName = path.basename(options.manuscriptPath);

  let completedTypes: string[] = [];

  // On resume, load which types are already done
  if (options.resume) {
    const existing = await readState();
    if (existing) completedTypes = existing.completedTypes ?? [];
  }

  const typesToRun = options.analysisTypes.filter(t => !completedTypes.includes(t));

  // Chunk the manuscript
  let chunks: ChunkInfo[];
  try {
    chunks = await chunkManuscript(options.manuscriptPath, options.chunkSize ?? 40_000);
  } catch (err: any) {
    onEvent({ type: 'error', error: `Failed to chunk manuscript: ${err.message}`, recoverable: false });
    return;
  }

  const state: PipelineStatus = {
    runId: `${Date.now()}`,
    startedAt: new Date().toISOString(),
    manuscriptPath: options.manuscriptPath,
    totalChunks: chunks.length,
    model: options.model,
    completedTypes,
    status: 'running',
  };
  await writeState(state);

  onEvent({ type: 'pipeline_start', totalChunks: chunks.length, analysisTypes: typesToRun });

  for (const analysisType of typesToRun) {
    if (abort.signal.aborted) break;

    onEvent({ type: 'analysis_type_start', analysisType });

    const outputDocPath = OUTPUT_DOCS[analysisType];
    const systemPrompt = analysisType === 'plot'
      ? PLOT_SYSTEM_PROMPT
      : analysisType === 'character'
        ? CHARACTER_SYSTEM_PROMPT
        : VOICE_SYSTEM_PROMPT;

    const chunksForType = analysisType === 'voice'
      ? selectVoiceChunks(chunks)
      : chunks.map((c, i) => ({ chunk: c, sampleLabel: '', sampleNum: i + 1 }));

    let consecutiveFailures = 0;

    for (const { chunk, sampleLabel, sampleNum } of chunksForType) {
      if (abort.signal.aborted) break;

      onEvent({
        type: 'chunk_start',
        analysisType,
        chunkIndex: chunk.index,
        totalChunksForType: chunksForType.length,
      });

      const isFirst = sampleNum === 1;
      let userMessage: string;

      if (analysisType === 'plot') {
        userMessage = buildPlotChunkMessage({
          index: chunk.index, total: chunk.total,
          charStart: chunk.charStart, charEnd: chunk.charEnd,
          chunkPath: chunk.projectRelPath, outputDocPath,
          manuscriptName, runDate, isFirst,
        });
      } else if (analysisType === 'character') {
        userMessage = buildCharacterChunkMessage({
          index: chunk.index, total: chunk.total,
          charStart: chunk.charStart, charEnd: chunk.charEnd,
          chunkPath: chunk.projectRelPath, outputDocPath,
          manuscriptName, runDate, isFirst,
        });
      } else {
        userMessage = buildVoiceChunkMessage({
          index: chunk.index, total: chunk.total,
          charStart: chunk.charStart, charEnd: chunk.charEnd,
          chunkPath: chunk.projectRelPath, outputDocPath,
          manuscriptName, runDate, sampleLabel, sampleNum, isFirst,
        });
      }

      try {
        await callClaudeForChunk(systemPrompt, userMessage, options.model, onEvent, abort.signal);
        consecutiveFailures = 0;
      } catch (err: any) {
        if (abort.signal.aborted) break;
        consecutiveFailures++;
        onEvent({
          type: 'error',
          error: `Chunk ${chunk.index} failed: ${err.message}`,
          recoverable: consecutiveFailures < 3,
          analysisType,
          chunkIndex: chunk.index,
        });
        if (consecutiveFailures >= 3) {
          onEvent({ type: 'error', error: `${analysisType} analysis aborted after 3 consecutive failures.`, recoverable: false });
          break;
        }
      }

      onEvent({ type: 'chunk_done', analysisType, chunkIndex: chunk.index });
    }

    if (!abort.signal.aborted) {
      completedTypes.push(analysisType);
      state.completedTypes = completedTypes;
      await writeState(state);
      onEvent({ type: 'analysis_type_done', analysisType });
    }
  }

  if (abort.signal.aborted) {
    state.status = 'cancelled';
  } else {
    state.status = 'complete';
    await cleanupChunks();
  }
  await writeState(state);

  onEvent({ type: 'pipeline_done' });
  _abortController = null;
}
