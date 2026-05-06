import fs from 'fs/promises';
import path from 'path';
import { BOOK_ROOT } from '../config.js';

export interface FileNode {
  name: string;
  path: string; // relative to root
  type: 'file' | 'directory';
  children?: FileNode[];
}

function ensureWithinRoot(filePath: string, root: string): string {
  const resolved = path.resolve(root, filePath);
  if (!resolved.startsWith(root)) {
    throw new Error('Path traversal denied');
  }
  return resolved;
}

export async function listFiles(dirPath: string = '', root: string = BOOK_ROOT): Promise<FileNode[]> {
  const absDir = ensureWithinRoot(dirPath, root);
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    const relativePath = path.join(dirPath, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      const children = await listFiles(relativePath, root);
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

export async function readFile(filePath: string, root: string = BOOK_ROOT): Promise<string> {
  const absPath = ensureWithinRoot(filePath, root);
  return fs.readFile(absPath, 'utf-8');
}

export async function writeFile(filePath: string, content: string, root: string = BOOK_ROOT): Promise<void> {
  const absPath = ensureWithinRoot(filePath, root);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf-8');
}

export async function createDirectory(dirPath: string, root: string = BOOK_ROOT): Promise<void> {
  const absPath = ensureWithinRoot(dirPath, root);
  await fs.mkdir(absPath, { recursive: true });
}

export async function getProjectContext(root: string = BOOK_ROOT): Promise<object> {
  const tree = await listFiles('', root);

  const countFiles = (nodes: FileNode[]): number =>
    nodes.reduce((n, node) => n + (node.type === 'file' ? 1 : countFiles(node.children || [])), 0);

  const versions: Record<string, string[]> = {};
  try {
    const chaptersDir = 'Chapters';
    const versionDirs = await fs.readdir(ensureWithinRoot(chaptersDir, root), { withFileTypes: true });
    for (const vd of versionDirs) {
      if (vd.isDirectory()) {
        const files = await fs.readdir(ensureWithinRoot(`${chaptersDir}/${vd.name}`, root));
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
