import fs from 'fs/promises';
import path from 'path';
import { getProjectPaths, updateProjectStatus } from './projectService.js';
import { claudeCli } from './cliService.js';

interface ChapterPattern {
  type: 'day' | 'chapter' | 'part' | 'section';
  pattern: string;
  label: string;
}

interface ChapterEntry {
  label: string;
  filename: string;
  content: string;
}

export interface SplitResult {
  chaptersCreated: number;
  chapterFiles: string[];
}

async function detectChapterPattern(
  sample: string,
  model: 'haiku' | 'sonnet' | 'opus',
): Promise<ChapterPattern> {
  const prompt = `Analyze this book text sample and identify the pattern used for chapter or section headings.

Text sample:
${sample.slice(0, 6000)}

Return ONLY a valid JSON object with no markdown, code fences, or explanation:
{
  "type": "day|chapter|part|section",
  "pattern": "regex to match headings at start of line, e.g. ^Day \\\\d+ or ^Chapter \\\\d+ or ^PART [IVX]+",
  "label": "human label e.g. Day {n} or Chapter {n}"
}

If no clear structural pattern exists, return: {"type":"section","pattern":"^\\\\*\\\\*\\\\*|^---","label":"Section {n}"}`;

  try {
    const raw = await claudeCli(prompt, model, 60_000);
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned) as ChapterPattern;
    if (!parsed.pattern || !parsed.type) throw new Error('incomplete response');
    return parsed;
  } catch (e) {
    console.warn('[split] Pattern detection failed, using default:', e);
    return { type: 'chapter', pattern: '^Chapter \\d+', label: 'Chapter {n}' };
  }
}

function splitByPattern(content: string, pattern: ChapterPattern): ChapterEntry[] {
  const lines = content.split('\n');
  let regex: RegExp;
  try {
    regex = new RegExp(pattern.pattern, 'i');
  } catch {
    regex = /^chapter\s+\d+/i;
  }

  const headingIndices: number[] = [];
  const headingLabels: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i].trim()) && lines[i].trim().length > 0) {
      headingIndices.push(i);
      headingLabels.push(lines[i].trim());
    }
  }

  if (headingIndices.length === 0) {
    return [{ label: 'Full Book', filename: 'full_book.txt', content }];
  }

  const chapters: ChapterEntry[] = [];

  if (headingIndices[0] > 5) {
    const preamble = lines.slice(0, headingIndices[0]).join('\n').trim();
    if (preamble.length > 100) {
      chapters.push({ label: 'Preamble', filename: '00_preamble.txt', content: preamble });
    }
  }

  for (let i = 0; i < headingIndices.length; i++) {
    const start = headingIndices[i];
    const end = i < headingIndices.length - 1 ? headingIndices[i + 1] : lines.length;
    const chapterContent = lines.slice(start, end).join('\n').trim();
    const num = String(i + 1).padStart(2, '0');
    const headingLabel = headingLabels[i];

    const slug = headingLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);

    chapters.push({
      label: headingLabel,
      filename: `${pattern.type}_${num}_${slug}.txt`,
      content: chapterContent,
    });
  }

  return chapters;
}

export async function splitBookIntoChapters(
  projectId: string,
  rawFilePath: string,
  model: 'haiku' | 'sonnet' | 'opus' = 'sonnet',
): Promise<SplitResult> {
  const paths = getProjectPaths(projectId);
  await updateProjectStatus(projectId, { splitChapters: 'running' });

  try {
    const bookContent = await fs.readFile(rawFilePath, 'utf-8');
    const pattern = await detectChapterPattern(bookContent, model);

    console.log(`[split] Detected pattern: type=${pattern.type} pattern="${pattern.pattern}"`);

    const chapters = splitByPattern(bookContent, pattern);

    await fs.mkdir(paths.chapters, { recursive: true });

    const chapterFiles: string[] = [];
    for (const chapter of chapters) {
      const outPath = path.join(paths.chapters, chapter.filename);
      await fs.writeFile(outPath, chapter.content, 'utf-8');
      chapterFiles.push(chapter.filename);
      console.log(`[split] Wrote ${chapter.filename} (${chapter.content.length} chars)`);
    }

    await updateProjectStatus(projectId, { splitChapters: 'done' });
    return { chaptersCreated: chapters.length, chapterFiles };
  } catch (err) {
    await updateProjectStatus(projectId, { splitChapters: 'error' });
    throw err;
  }
}
