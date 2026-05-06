import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root: AI_Book_Editor/
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// Legacy single-book path (backward compat — 'builtin' project ID)
export const BOOK_ROOT = path.join(PROJECT_ROOT, 'BookFiles', 'RokosBasilisk');

// Multi-project directory: AI_Book_Editor/Projects/
export const PROJECTS_DIR = path.join(PROJECT_ROOT, 'Projects');

// Legacy subdirectories (used by existing services)
export const CHAPTERS_DIR = path.join(BOOK_ROOT, 'Chapters');
export const RAW_FILES_DIR = path.join(BOOK_ROOT, 'RawFiles');
export const AI_ANALYSIS_DIR = path.join(BOOK_ROOT, 'AI_Analysis_Output');
export const EDITORIAL_DIR = path.join(BOOK_ROOT, 'EditorialGuidance_Directions');
export const MISC_CONTEXT_DIR = path.join(BOOK_ROOT, 'MiscContext');

export const PORT = 3001;

// Resolve the file-system root for a given projectId.
// 'builtin' or undefined → legacy BOOK_ROOT (BookFiles/RokosBasilisk)
// Any real UUID → Projects/{id}/
export function getBookRoot(projectId?: string): string {
  if (!projectId || projectId === 'builtin') return BOOK_ROOT;
  return path.join(PROJECTS_DIR, projectId);
}

export function getEditorialDir(projectId?: string): string {
  return path.join(getBookRoot(projectId), 'EditorialGuidance_Directions');
}
