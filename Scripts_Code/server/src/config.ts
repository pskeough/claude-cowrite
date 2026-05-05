import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root: AI_Book_Editor/
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// All file I/O scoped under this directory
export const BOOK_ROOT = path.join(PROJECT_ROOT, 'BookFiles', 'RokosBasilisk');

// Subdirectories
export const CHAPTERS_DIR = path.join(BOOK_ROOT, 'Chapters');
export const RAW_FILES_DIR = path.join(BOOK_ROOT, 'RawFiles');
export const AI_ANALYSIS_DIR = path.join(BOOK_ROOT, 'AI_Analysis_Output');
export const EDITORIAL_DIR = path.join(BOOK_ROOT, 'EditorialGuidance_Directions');
export const MISC_CONTEXT_DIR = path.join(BOOK_ROOT, 'MiscContext');

export const PORT = 3001;
