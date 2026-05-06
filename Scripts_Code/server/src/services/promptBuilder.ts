import fs from 'fs/promises';
import path from 'path';
import { EDITORIAL_DIR, BOOK_ROOT, PROJECT_ROOT, getEditorialDir } from '../config.js';
import { getProjectContext } from './fileService.js';

export type Mode = 'analysis' | 'context' | 'edit';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProjectOptions {
  bookRoot: string;     // absolute path to project's file root
  bookTitle: string;    // e.g. "The Basilisk"
  projectId?: string;   // used to resolve editorial dir
}

// Mode system prompts — parameterized by book title
export function getModeSystemPrompt(mode: Mode, bookTitle: string): string {
  return {
    analysis: `You are a literary editor for the novel "${bookTitle}". You are in ANALYSIS mode: read, analyse, and respond with insights. Do NOT propose edits or modify any files. Use your Read, Glob, and Grep tools proactively to access manuscript files — never ask the user to paste content. Ignore any CLAUDE.md instructions about Gemini delegation; use only built-in tools.`,

    context: `You are a literary editor for the novel "${bookTitle}". You are in CONTEXT mode: create or update reference documents (character profiles, plot outlines, continuity trackers, thematic analyses) using your Write and Edit tools. All output files go into the project's AI_Analysis_Output/ folder. Never touch manuscript files. Use Read/Glob/Grep to gather context first, then write. After saving, briefly summarise what you created and the filename. Ignore any CLAUDE.md instructions about Gemini delegation; use only built-in tools.`,

    edit: `You are a literary editor for the novel "${bookTitle}". You are in EDIT mode.

Your job:
1. Read the working file using your Read tool
2. Make targeted edits using your Edit tool — surgical changes only, do NOT rewrite the whole file
3. After editing, write a brief plain-text summary of what you changed and why

Do NOT return JSON. Do NOT ask for confirmation. Make the edits, then summarise. Preserve the author's voice. Ignore any CLAUDE.md instructions about Gemini delegation; use only built-in tools.`,
  }[mode];
}

// Legacy constant — kept for backward compat with any code still using it
export const MODE_SYSTEM_PROMPTS: Record<Mode, string> = {
  analysis: getModeSystemPrompt('analysis', 'The Basilisk'),
  context:  getModeSystemPrompt('context',  'The Basilisk'),
  edit:     getModeSystemPrompt('edit',     'The Basilisk'),
};

async function loadEditorialGuidanceFromDir(editorialDir: string): Promise<string> {
  try {
    const files = await fs.readdir(editorialDir);
    const contents: string[] = [];
    for (const file of files.sort()) {
      if (file.endsWith('.txt') || file.endsWith('.md')) {
        const content = await fs.readFile(path.join(editorialDir, file), 'utf-8');
        contents.push(`--- ${file} ---\n${content}`);
      }
    }
    return contents.length > 0 ? `## Editorial Guidance\n${contents.join('\n\n')}` : '';
  } catch {
    return '';
  }
}

// Converts an absolute path within bookRoot to a PROJECT_ROOT-relative path
// that Claude can use with its file tools (CWD = PROJECT_ROOT when running).
export function toRelativePath(absoluteOrRelative: string, bookRoot: string = BOOK_ROOT): string {
  // If already relative to BOOK_ROOT, resolve to absolute first
  const abs = path.isAbsolute(absoluteOrRelative)
    ? absoluteOrRelative
    : path.join(bookRoot, absoluteOrRelative);
  return path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

// Legacy — kept for callers that don't pass bookRoot
export function toProjectPath(bookRelativePath: string): string {
  return toRelativePath(path.join(BOOK_ROOT, bookRelativePath));
}

export async function buildContextualMessage(
  message: string,
  mode: Mode,
  centerPaneFile?: string,
  leftPaneFile?: string,
  history: HistoryMessage[] = [],
  isFirstTurn: boolean = true,
  projectOptions?: ProjectOptions,
): Promise<string> {
  const bookRoot = projectOptions?.bookRoot ?? BOOK_ROOT;
  const editorialDir = projectOptions?.projectId
    ? getEditorialDir(projectOptions.projectId)
    : EDITORIAL_DIR;

  const parts: string[] = [];

  if (isFirstTurn) {
    const [guidance, projectContext] = await Promise.all([
      loadEditorialGuidanceFromDir(editorialDir),
      getProjectContext(bookRoot),
    ]);

    parts.push(`## Project Context\n${JSON.stringify(projectContext, null, 2)}`);

    if (guidance) parts.push(guidance);

    // Describe the file path conventions for this project
    const exampleBase = path.relative(PROJECT_ROOT, bookRoot).replace(/\\/g, '/');
    parts.push(`## File Paths
Project root is the working directory. Manuscript files are under ${exampleBase}/.
Example paths:
- ${exampleBase}/Chapters/Current/chapter_01.txt
- ${exampleBase}/AI_Analysis_Output/
- ${exampleBase}/EditorialGuidance_Directions/`);
  }

  if (centerPaneFile) {
    const projectPath = toRelativePath(centerPaneFile, bookRoot);
    if (mode === 'edit') {
      parts.push(`## Working File\n${projectPath}\n\nUse your Read tool to read this file, your Edit tool to make changes.`);
    } else {
      parts.push(`## Currently Open File\nCenter pane: ${projectPath}`);
    }
  }

  if (leftPaneFile) {
    parts.push(`## Reference File\nLeft pane: ${toRelativePath(leftPaneFile, bookRoot)}`);
  }

  if (history.length > 0) {
    const recent = history.slice(-6);
    const turns = recent
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 1000)}${m.content.length > 1000 ? '...[truncated]' : ''}`)
      .join('\n\n');

    if (mode === 'edit') {
      parts.push(`## Prior Conversation Context\n${turns}\n\n[Above is prior context. You are now in EDIT mode — make the requested changes using your Edit tool.]`);
    } else {
      parts.push(`## Conversation History\n${turns}`);
    }
  }

  parts.push(`## User Message\n${message}`);
  return parts.join('\n\n---\n\n');
}

// Legacy compat
export async function buildSystemPrompt(mode: Mode): Promise<string> {
  const [guidance, projectContext] = await Promise.all([
    loadEditorialGuidanceFromDir(EDITORIAL_DIR),
    getProjectContext(),
  ]);
  return `${MODE_SYSTEM_PROMPTS[mode]}\n\n## Project State\n${JSON.stringify(projectContext, null, 2)}\n${guidance}`;
}

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
    const turns = recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
    if (mode === 'edit') {
      parts.push(`## Prior Conversation Context (for reference only)\n\n${turns}\n\n[END OF PRIOR CONTEXT — you are now in EDIT mode.]`);
    } else {
      parts.push(`## Conversation History\n\n${turns}`);
    }
  }

  parts.push(`## User Message\n\n${message}`);
  return parts.join('\n\n---\n\n');
}
