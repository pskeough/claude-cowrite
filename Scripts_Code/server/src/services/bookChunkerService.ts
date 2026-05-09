import fs from 'fs/promises';
import path from 'path';
import { BOOK_ROOT, AI_ANALYSIS_DIR, PROJECT_ROOT } from '../config.js';

export interface ChunkInfo {
  index: number;
  total: number;
  charStart: number;
  charEnd: number;
  projectRelPath: string;  // PROJECT_ROOT-relative, forward slashes — for Claude's Read tool
}

const CHUNKS_DIR = path.join(AI_ANALYSIS_DIR, '.chunks');
const OVERLAP_CHARS = 500;

export function toProjectRelative(absPath: string): string {
  return path.relative(PROJECT_ROOT, absPath).replace(/\\/g, '/');
}

export async function chunkManuscript(
  manuscriptRelPath: string,   // relative to BOOK_ROOT
  chunkSize = 40_000,
): Promise<ChunkInfo[]> {
  const absPath = path.join(BOOK_ROOT, manuscriptRelPath);
  const text = await fs.readFile(absPath, 'utf-8');

  await fs.rm(CHUNKS_DIR, { recursive: true, force: true });
  await fs.mkdir(CHUNKS_DIR, { recursive: true });

  // Build chunk boundaries, splitting on the nearest natural break before each target.
  // Priority: CRLF paragraph break → LF paragraph break → any line break → sentence end → exact target.
  // This handles manuscripts with \r\n endings and dense prose blocks without paragraph gaps.
  const boundaries: number[] = [0];
  let pos = 0;

  while (pos < text.length) {
    const target = pos + chunkSize;
    if (target >= text.length) {
      boundaries.push(text.length);
      break;
    }

    const searchStart = Math.max(pos, target - 2000);
    const window = text.slice(searchStart, target + 500);
    const wt = target - searchStart;  // target offset within window

    // 1. CRLF paragraph break (\r\n\r\n)
    let breakIdx = window.lastIndexOf('\r\n\r\n', wt);
    let breakLen = 4;

    // 2. LF paragraph break (\n\n)
    if (breakIdx === -1) {
      breakIdx = window.lastIndexOf('\n\n', wt);
      breakLen = 2;
    }

    // 3. Any CRLF line break (\r\n) — catches dialogue/scene-level breaks
    if (breakIdx === -1) {
      breakIdx = window.lastIndexOf('\r\n', wt);
      breakLen = 2;
    }

    // 4. Any LF line break (\n)
    if (breakIdx === -1) {
      breakIdx = window.lastIndexOf('\n', wt);
      breakLen = 1;
    }

    // 5. Sentence end ('. ') within 1000 chars of target
    if (breakIdx === -1) {
      const sentWindow = window.slice(Math.max(0, wt - 1000), wt);
      const sentIdx = sentWindow.lastIndexOf('. ');
      if (sentIdx !== -1) {
        breakIdx = Math.max(0, wt - 1000) + sentIdx + 2;
        breakLen = 0;
      }
    }

    const absBreak = breakIdx !== -1 ? searchStart + breakIdx + breakLen : target;
    boundaries.push(absBreak);
    pos = absBreak;
  }

  const chunks: ChunkInfo[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const index = i + 1;

    // Prepend 500-char overlap from previous chunk for continuity
    let content = '';
    if (i > 0) {
      const overlapText = text.slice(Math.max(0, start - OVERLAP_CHARS), start);
      content = `[CARRY-OVER — continuity context only, do not re-document]\n${overlapText.trim()}\n[END CARRY-OVER]\n\n`;
    }
    content += text.slice(start, end);

    const paddedIndex = String(index).padStart(3, '0');
    const filePath = path.join(CHUNKS_DIR, `chunk_${paddedIndex}.txt`);
    await fs.writeFile(filePath, content, 'utf-8');

    chunks.push({
      index,
      total: 0,
      charStart: start,
      charEnd: end,
      projectRelPath: toProjectRelative(filePath),
    });
  }

  for (const c of chunks) c.total = chunks.length;
  return chunks;
}

export async function cleanupChunks(): Promise<void> {
  await fs.rm(CHUNKS_DIR, { recursive: true, force: true });
}
