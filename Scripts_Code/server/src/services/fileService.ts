import fs from 'fs/promises';
import path from 'path';
import { BOOK_ROOT } from '../config.js';

export interface FileNode {
  name: string;
  path: string; // relative to BOOK_ROOT
  type: 'file' | 'directory';
  children?: FileNode[];
}

function ensureWithinRoot(filePath: string): string {
  const resolved = path.resolve(BOOK_ROOT, filePath);
  if (!resolved.startsWith(BOOK_ROOT)) {
    throw new Error('Path traversal denied');
  }
  return resolved;
}

export async function listFiles(dirPath: string = ''): Promise<FileNode[]> {
  const absDir = ensureWithinRoot(dirPath);
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    const relativePath = path.join(dirPath, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      const children = await listFiles(relativePath);
      nodes.push({ name: entry.name, path: relativePath, type: 'directory', children });
    } else {
      nodes.push({ name: entry.name, path: relativePath, type: 'file' });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readFile(filePath: string): Promise<string> {
  const absPath = ensureWithinRoot(filePath);
  return fs.readFile(absPath, 'utf-8');
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  const absPath = ensureWithinRoot(filePath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf-8');
}

export async function createDirectory(dirPath: string): Promise<void> {
  const absPath = ensureWithinRoot(dirPath);
  await fs.mkdir(absPath, { recursive: true });
}

export async function getProjectContext(): Promise<object> {
  const tree = await listFiles();

  const countFiles = (nodes: FileNode[]): number =>
    nodes.reduce((n, node) => n + (node.type === 'file' ? 1 : countFiles(node.children || [])), 0);

  // List chapter versions
  const versions: Record<string, string[]> = {};
  try {
    const chaptersDir = 'Chapters';
    const versionDirs = await fs.readdir(ensureWithinRoot(chaptersDir), { withFileTypes: true });
    for (const vd of versionDirs) {
      if (vd.isDirectory()) {
        const files = await fs.readdir(ensureWithinRoot(`${chaptersDir}/${vd.name}`));
        versions[vd.name] = files.filter(f => f.endsWith('.txt')).sort();
      }
    }
  } catch { /* Chapters dir may not exist */ }

  return {
    totalFiles: countFiles(tree),
    versions,
    directories: tree.filter(n => n.type === 'directory').map(n => n.name),
  };
}
