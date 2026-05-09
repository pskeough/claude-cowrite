import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from '../config.js';

export interface ChunkInfo {
  index: number;
  total: number;
  charStart: number;
  charEnd: number;
  projectRelPath: string;  // PROJECT_ROOT-relative, forward slashes — for Claude's Read tool
}

const OVERLAP_CHARS = 500;

export function toProjectRelative(absPath: string): string {
  return path.relative(PROJECT_ROOT, absPath).replace(/\\/g, '/');
}

/**
 * Splits a manuscript file into ~chunkSize-character chunks at natural boundaries
 * (CRLF/LF paragraph break → CRLF/LF line break → sentence end → exact target).
 * Each chunk gets a 500-char carry-over prefix from the previous chunk for continuity.
 *
 * Writes chunk files into `chunksDir/chunk_NNN.txt`. Caller manages lifecycle of chunksDir.
 */
export async function chunkManuscript(
  manuscriptAbsPath: string,
  chunksDir: string,
  chunkSize = 40_000,
): Promise<ChunkInfo[]> {
  const text = await fs.readFile(manuscriptAbsPath, 'utf-8');

  await fs.rm(chunksDir, { recursive: true, force: true });
  await fs.mkdir(chunksDir, { recursive: true });

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
    const wt = target - searchStart;

    let breakIdx = window.lastIndexOf('\r\n\r\n', wt);
    let breakLen = 4;

    if (breakIdx === -1) {
      breakIdx = window.lastIndexOf('\n\n', wt);
      breakLen = 2;
    }
    if (breakIdx === -1) {
      breakIdx = window.lastIndexOf('\r\n', wt);
      breakLen = 2;
    }
    if (breakIdx === -1) {
      breakIdx = window.lastIndexOf('\n', wt);
      breakLen = 1;
    }
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

    let content = '';
    if (i > 0) {
      const overlapText = text.slice(Math.max(0, start - OVERLAP_CHARS), start);
      content = `[CARRY-OVER — continuity context only, do not re-document]\n${overlapText.trim()}\n[END CARRY-OVER]\n\n`;
    }
    content += text.slice(start, end);

    const paddedIndex = String(index).padStart(3, '0');
    const filePath = path.join(chunksDir, `chunk_${paddedIndex}.txt`);
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

export async function cleanupChunks(chunksDir: string): Promise<void> {
  await fs.rm(chunksDir, { recursive: true, force: true });
}
