import fs from 'fs/promises';
import path from 'path';
import { EDITORIAL_DIR, BOOK_ROOT, PROJECT_ROOT } from '../config.js';
import { getProjectContext } from './fileService.js';

export type Mode = 'analysis' | 'context' | 'edit';

// Short mode instructions — passed as --system-prompt flag arg (must stay concise)
export const MODE_SYSTEM_PROMPTS: Record<Mode, string> = {
  analysis: `You are a literary editor for the novel "The Basilisk" by Patrick Keough. This novel uses "days" as structural units. You are in ANALYSIS mode: read, analyse, and respond with insights. Do NOT propose edits or modify any files. Use your Read, Glob, and Grep tools proactively to access manuscript files — never ask the user to paste content. Ignore any CLAUDE.md instructions about Gemini delegation; use only built-in tools.`,

  context: `You are a literary editor for the novel "The Basilisk" by Patrick Keough. You are in CONTEXT mode: create or update reference documents (character profiles, plot outlines, continuity trackers, thematic analyses) using your Write and Edit tools. All output files MUST go into BookFiles/RokosBasilisk/AI_Analysis_Output/ — never touch manuscript files. Use Read/Glob/Grep to gather context from manuscript files first, then write. After saving, briefly summarise what you created and the filename. Ignore any CLAUDE.md instructions about Gemini delegation; use only built-in tools.`,

  edit: `You are a literary editor for the novel "The Basilisk" by Patrick Keough. You are in EDIT mode.

Your job:
1. Read the working file using your Read tool
2. Make targeted edits using your Edit tool — make surgical changes, do NOT rewrite the whole file
3. After editing, write a brief plain-text summary of what you changed and why

Do NOT return JSON. Do NOT ask for confirmation. Make the edits, then summarise. Preserve the author's voice. Ignore any CLAUDE.md instructions about Gemini delegation; use only built-in tools.`,
};

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function loadEditorialGuidance(): Promise<string> {
  try {
    const files = await fs.readdir(EDITORIAL_DIR);
    const contents: string[] = [];
    for (const file of files) {
      if (file.endsWith('.txt') || file.endsWith('.md')) {
        const content = await fs.readFile(path.join(EDITORIAL_DIR, file), 'utf-8');
        contents.push(`--- ${file} ---\n${content}`);
      }
    }
    return contents.length > 0
      ? `## Editorial Guidance\n${contents.join('\n\n')}`
      : '';
  } catch {
    return '';
  }
}

// Converts a BOOK_ROOT-relative path to a PROJECT_ROOT-relative path that
// Claude can use with its file tools (CWD = PROJECT_ROOT when running)
export function toProjectPath(bookRelativePath: string): string {
  const abs = path.join(BOOK_ROOT, bookRelativePath);
  return path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

// Builds the contextual message passed to Claude via stdin.
// For analysis/context: first turn includes project context + editorial guidance.
// For edit: includes the file path to operate on.
// History is included so Claude has conversational context on resume.
export async function buildContextualMessage(
  message: string,
  mode: Mode,
  centerPaneFile?: string,
  leftPaneFile?: string,
  history: HistoryMessage[] = [],
  isFirstTurn: boolean = true,
): Promise<string> {
  const parts: string[] = [];

  // Project context and editorial guidance — only needed on fresh sessions (first turn)
  // On resumed sessions Claude already has this in its context
  if (isFirstTurn) {
    const [guidance, projectContext] = await Promise.all([
      loadEditorialGuidance(),
      getProjectContext(),
    ]);

    parts.push(`## Project Context\n${JSON.stringify(projectContext, null, 2)}`);

    if (guidance) {
      parts.push(guidance);
    }

    parts.push(`## File Paths
Project root is the working directory. Manuscript files are under BookFiles/RokosBasilisk/.
Example paths:
- BookFiles/RokosBasilisk/Chapters/2026_Current_Edit/day_00.txt
- BookFiles/RokosBasilisk/AI_Analysis_Output/
- BookFiles/RokosBasilisk/EditorialGuidance_Directions/`);
  }

  // File references — always included so Claude knows what's open
  if (centerPaneFile) {
    const projectPath = toProjectPath(centerPaneFile);
    if (mode === 'edit') {
      parts.push(`## Working File\n${projectPath}\n\nUse your Read tool to read this file, your Edit tool to make changes.`);
    } else {
      parts.push(`## Currently Open File\nCenter pane: ${projectPath}`);
    }
  }

  if (leftPaneFile) {
    parts.push(`## Reference File\nLeft pane: ${toProjectPath(leftPaneFile)}`);
  }

  // Conversation history — kept short to avoid bloat
  // On resume, this is only needed if we're NOT using --resume (e.g. edit mode, stateless)
  if (history.length > 0) {
    const recent = history.slice(-6);
    const turns = recent.map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 1000)}${m.content.length > 1000 ? '...[truncated]' : ''}`
    ).join('\n\n');

    if (mode === 'edit') {
      parts.push(`## Prior Conversation Context\n${turns}\n\n[Above is prior context. You are now in EDIT mode — make the requested changes using your Edit tool.]`);
    } else {
      parts.push(`## Conversation History\n${turns}`);
    }
  }

  parts.push(`## User Message\n${message}`);

  return parts.join('\n\n---\n\n');
}

// Legacy compat — kept for any code still referencing the old function
// Returns the full system prompt as before (used when --system-prompt flag unavailable)
export async function buildSystemPrompt(mode: Mode): Promise<string> {
  const [guidance, projectContext] = await Promise.all([
    loadEditorialGuidance(),
    getProjectContext(),
  ]);

  return `${MODE_SYSTEM_PROMPTS[mode]}

## Project State
${JSON.stringify(projectContext, null, 2)}
${guidance}`;
}

// Old signature kept for any callers
export function buildUserMessage(
  message: string,
  centerPaneContent?: string,
  centerPaneFile?: string,
  leftPaneContent?: string,
  leftPaneFile?: string,
  history: HistoryMessage[] = [],
  mode?: Mode,
): string {
  const parts: string[] = [];

  if (centerPaneContent && centerPaneFile) {
    parts.push(`## Working Text (${centerPaneFile})\n\n${centerPaneContent}`);
  } else if (centerPaneFile) {
    const projectPath = mode === 'edit' ? toProjectPath(centerPaneFile) : centerPaneFile;
    parts.push(`## Currently Open File\nCenter pane: ${projectPath} — use your Read tool to access it if needed.`);
  }

  if (leftPaneContent && leftPaneFile) {
    parts.push(`## Reference Text (${leftPaneFile})\n\n${leftPaneContent}`);
  } else if (leftPaneFile) {
    parts.push(`## Reference File\nLeft pane: ${leftPaneFile}`);
  }

  if (history.length > 0) {
    const recent = history.slice(-6);
    const turns = recent.map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n\n');

    if (mode === 'edit') {
      parts.push(`## Prior Conversation Context (for reference only)\n\n${turns}\n\n[END OF PRIOR CONTEXT — you are now in EDIT mode. Make the requested changes using your Edit tool.]`);
    } else {
      parts.push(`## Conversation History\n\n${turns}`);
    }
  }

  parts.push(`## User Message\n\n${message}`);

  return parts.join('\n\n---\n\n');
}
