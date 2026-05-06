import fs from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { getProjectPaths, getProject, updateProjectStatus } from './projectService.js';
import type { ProjectPaths } from './projectService.js';

const MODEL_IDS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-6',
} as const;

export interface AnalysisOptions {
  plotAnalysis: boolean;
  characterProfiles: boolean;
  voiceContext: boolean;
  model: 'haiku' | 'sonnet' | 'opus';
}

// In-memory progress per project (cleared when complete)
const progressMap = new Map<string, JobProgress>();

export interface JobProgress {
  currentTask: string;
  tasksTotal: number;
  tasksDone: number;
  errors: string[];
  complete: boolean;
}

export function getProgress(projectId: string): JobProgress | undefined {
  return progressMap.get(projectId);
}

export function queueAnalysis(projectId: string, options: AnalysisOptions): void {
  const tasksTotal = [options.plotAnalysis, options.characterProfiles, options.voiceContext].filter(Boolean).length;
  if (tasksTotal === 0) return;

  const progress: JobProgress = {
    currentTask: 'Starting analysis...',
    tasksTotal,
    tasksDone: 0,
    errors: [],
    complete: false,
  };
  progressMap.set(projectId, progress);

  runAnalysis(projectId, options, progress).catch(err => {
    progress.errors.push(String(err.message));
    progress.complete = true;
    console.error(`[analysis-queue] Fatal error for ${projectId}:`, err);
  });
}

async function runAnalysis(projectId: string, options: AnalysisOptions, progress: JobProgress): Promise<void> {
  const paths = getProjectPaths(projectId);

  let chapterFiles: string[] = [];
  try {
    const all = await fs.readdir(paths.chapters);
    chapterFiles = all.filter(f => f.endsWith('.txt')).sort();
  } catch {
    // chapters dir doesn't exist yet
  }

  if (chapterFiles.length === 0) {
    progress.errors.push('No chapter files found in Chapters/Current/. Run chapter split first.');
    progress.complete = true;
    return;
  }

  const project = await getProject(projectId);
  const bookTitle = project.bookTitle || project.name;

  if (options.plotAnalysis) {
    progress.currentTask = 'Analyzing plot and narrative...';
    await updateProjectStatus(projectId, { plotAnalysis: 'running' });
    try {
      await analyzePlot(chapterFiles, paths, bookTitle, options.model, progress);
      await updateProjectStatus(projectId, { plotAnalysis: 'done' });
    } catch (err: any) {
      progress.errors.push(`Plot analysis: ${err.message}`);
      await updateProjectStatus(projectId, { plotAnalysis: 'error' });
    }
    progress.tasksDone++;
  }

  if (options.characterProfiles) {
    progress.currentTask = 'Building character profiles...';
    await updateProjectStatus(projectId, { characterProfiles: 'running' });
    try {
      await analyzeCharacters(chapterFiles, paths, bookTitle, options.model, progress);
      await updateProjectStatus(projectId, { characterProfiles: 'done' });
    } catch (err: any) {
      progress.errors.push(`Character profiles: ${err.message}`);
      await updateProjectStatus(projectId, { characterProfiles: 'error' });
    }
    progress.tasksDone++;
  }

  if (options.voiceContext) {
    progress.currentTask = 'Analyzing authorial voice...';
    await updateProjectStatus(projectId, { voiceContext: 'running' });
    try {
      await analyzeVoice(chapterFiles, paths, bookTitle, options.model, progress);
      await updateProjectStatus(projectId, { voiceContext: 'done' });
    } catch (err: any) {
      progress.errors.push(`Voice context: ${err.message}`);
      await updateProjectStatus(projectId, { voiceContext: 'error' });
    }
    progress.tasksDone++;
  }

  progress.currentTask = 'Complete';
  progress.complete = true;
}

// --- Generic chapter-by-chapter + synthesis helper ---

async function chapterByChapterAnalysis(
  chapterFiles: string[],
  chaptersDir: string,
  systemPrompt: string,
  perChapterPrompt: (label: string, content: string) => string,
  synthesisPrompt: (perChapterResults: string) => string,
  model: 'haiku' | 'sonnet' | 'opus',
  onProgress: (msg: string) => void,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });
  const modelId = MODEL_IDS[model];

  const perChapterResults: string[] = [];

  for (const filename of chapterFiles) {
    onProgress(`Processing ${filename}...`);
    const raw = await fs.readFile(path.join(chaptersDir, filename), 'utf-8');
    // Truncate very long chapters to stay within token budget
    const content = raw.length > 14000 ? raw.slice(0, 14000) + '\n[...truncated]' : raw;
    const label = filename.replace(/\.txt$/, '');

    const response = await client.messages.create({
      model: modelId,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: perChapterPrompt(label, content) }],
    });
    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    perChapterResults.push(`## ${label}\n\n${text}`);
  }

  // Synthesis step — combine all per-chapter analyses into one document
  onProgress('Synthesizing final document...');
  const combined = perChapterResults.join('\n\n---\n\n');
  const truncatedForSynthesis = combined.length > 48000
    ? combined.slice(0, 48000) + '\n\n[...additional chapters truncated]'
    : combined;

  const synthResponse = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: synthesisPrompt(truncatedForSynthesis) }],
  });

  return synthResponse.content.find(b => b.type === 'text')?.text ?? '';
}

// --- Analysis task implementations ---

async function analyzePlot(
  chapterFiles: string[],
  paths: ProjectPaths,
  bookTitle: string,
  model: 'haiku' | 'sonnet' | 'opus',
  progress: JobProgress,
): Promise<void> {
  const result = await chapterByChapterAnalysis(
    chapterFiles,
    paths.chapters,
    `You are a literary analyst examining "${bookTitle}". Be precise, insightful, and concise.`,
    (label, content) =>
      `Analyze the plot and narrative of this chapter. Note: major events, developments, themes, pacing, foreshadowing, and any callbacks to earlier material.\n\nChapter: ${label}\n\n${content}`,
    (combined) =>
      `You have analyzed each chapter of "${bookTitle}" individually. Synthesize a comprehensive plot and narrative analysis of the entire book.\n\nInclude:\n1. Overall narrative arc and structure\n2. Major plot points and turning points\n3. Thematic threads\n4. Pacing and structural observations\n5. Concise chapter-by-chapter summary\n\nPer-chapter data:\n\n${combined}`,
    model,
    (msg) => { progress.currentTask = msg; },
  );

  const header = `# Plot & Narrative Analysis\n\n*${bookTitle}*  \nGenerated: ${new Date().toLocaleString()} · Model: ${model}\n\n---\n\n`;
  await fs.writeFile(path.join(paths.aiOutput, 'plot_narrative_analysis.md'), header + result, 'utf-8');
  console.log(`[analysis] Plot analysis written for ${bookTitle}`);
}

async function analyzeCharacters(
  chapterFiles: string[],
  paths: ProjectPaths,
  bookTitle: string,
  model: 'haiku' | 'sonnet' | 'opus',
  progress: JobProgress,
): Promise<void> {
  const result = await chapterByChapterAnalysis(
    chapterFiles,
    paths.chapters,
    `You are a literary analyst building character profiles for "${bookTitle}". Focus on specific textual evidence — quote directly.`,
    (label, content) =>
      `Extract character information from this chapter. For each character that appears note: physical description, personality traits, key dialogue (quote verbatim), relationships, and development.\n\nChapter: ${label}\n\n${content}`,
    (combined) =>
      `Based on the chapter data from "${bookTitle}", create comprehensive character profiles.\n\nFor each significant character include:\n1. **Physical Description** (verbatim evidence)\n2. **Personality & Psychology**\n3. **Origin & Background**\n4. **Key Dialogue** (direct quotes)\n5. **Relationships & Dynamics**\n6. **Character Arc**\n\nChapter data:\n\n${combined}`,
    model,
    (msg) => { progress.currentTask = msg; },
  );

  const header = `# Character Profiles\n\n*${bookTitle}*  \nGenerated: ${new Date().toLocaleString()} · Model: ${model}\n\n---\n\n`;
  await fs.writeFile(path.join(paths.aiOutput, 'character_profiles.md'), header + result, 'utf-8');
  console.log(`[analysis] Character profiles written for ${bookTitle}`);
}

async function analyzeVoice(
  chapterFiles: string[],
  paths: ProjectPaths,
  bookTitle: string,
  model: 'haiku' | 'sonnet' | 'opus',
  progress: JobProgress,
): Promise<void> {
  // Sample strategically for voice: first, middle, last chapter
  const sampleFiles = chapterFiles.length > 4
    ? [
        chapterFiles[0],
        chapterFiles[Math.floor(chapterFiles.length / 2)],
        chapterFiles[chapterFiles.length - 1],
      ]
    : chapterFiles;

  const result = await chapterByChapterAnalysis(
    sampleFiles,
    paths.chapters,
    `You are a literary stylist analyzing the authorial voice of "${bookTitle}" for ghost-writing and editorial context.`,
    (label, content) =>
      `Analyze the authorial voice in this chapter. Note: sentence rhythm and length, vocabulary register, prose density (sparse vs lush), POV intimacy, internal monologue style, sensory language, and distinctive stylistic tics.\n\nChapter: ${label}\n\n${content}`,
    (combined) =>
      `Create a comprehensive authorial voice and ghost-writing guide for "${bookTitle}".\n\nInclude:\n1. **Voice Signature** — the distinctive feel of this prose in 2-3 sentences\n2. **Sentence & Rhythm Patterns** — with examples\n3. **Vocabulary Register** — word-choice tendencies\n4. **Prose Style Characteristics** — density, imagery, interiority\n5. **What to Avoid** — common voice-breaking mistakes\n6. **Ghost-Writing Instructions** — specific guidance for maintaining this voice in new material\n\nStyle samples:\n\n${combined}`,
    model,
    (msg) => { progress.currentTask = msg; },
  );

  // Save to EditorialGuidance_Directions so the editor auto-loads it
  const header = `# Authorial Voice & Ghost-Writing Context\n\n*${bookTitle}*  \nGenerated: ${new Date().toLocaleString()} · Model: ${model}\n\n---\n\n`;
  await fs.writeFile(
    path.join(paths.editorial, 'authorial_voice_context.md'),
    header + result,
    'utf-8',
  );
  console.log(`[analysis] Voice context written for ${bookTitle}`);
}
