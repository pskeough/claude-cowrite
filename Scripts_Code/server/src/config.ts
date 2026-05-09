import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root: AI_Book_Editor/
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// Multi-project directory: AI_Book_Editor/Projects/
export const PROJECTS_DIR = path.join(PROJECT_ROOT, 'Projects');

export const PORT = 3001;

// Deprecated default-root fallbacks. Real requests always carry a projectId
// and resolve via getBookRoot(); these only exist so default-parameter signatures
// in fileService/promptBuilder/claudeDirectService still compile. They point at
// a sentinel folder that shouldn't contain manuscript data.
export const BOOK_ROOT = path.join(PROJECT_ROOT, '.no-project');
export const CHAPTERS_DIR = path.join(BOOK_ROOT, 'Chapters');
export const RAW_FILES_DIR = path.join(BOOK_ROOT, 'RawFiles');
export const AI_ANALYSIS_DIR = path.join(BOOK_ROOT, 'AI_Analysis_Output');
export const EDITORIAL_DIR = path.join(BOOK_ROOT, 'EditorialGuidance_Directions');
export const MISC_CONTEXT_DIR = path.join(BOOK_ROOT, 'MiscContext');

// Resolve the file-system root for a given projectId.
export function getBookRoot(projectId?: string): string {
  if (!projectId) return BOOK_ROOT;
  return path.join(PROJECTS_DIR, projectId);
}

export function getEditorialDir(projectId?: string): string {
  return path.join(getBookRoot(projectId), 'EditorialGuidance_Directions');
}
