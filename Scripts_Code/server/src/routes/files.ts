import { Router } from 'express';
import { listFiles, readFile, writeFile, createDirectory } from '../services/fileService.js';
import { getBookRoot } from '../config.js';

const router = Router();

function rootFromReq(req: { query: { projectId?: unknown } }): string {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  return getBookRoot(projectId);
}

// Extract wildcard path segment — Express types `params[0]` as `string[]` on some versions
function paramPath(req: { params: Record<string, string | string[]> }): string {
  const p = req.params[0];
  return Array.isArray(p) ? p.join('/') : (p ?? '');
}

// GET /api/files?projectId=xxx — full file tree
router.get('/', async (req, res) => {
  try {
    const root = rootFromReq(req);
    const tree = await listFiles('', root);
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// GET /api/files/*?projectId=xxx — read file by relative path
router.get('/*', async (req, res) => {
  try {
    const filePath = paramPath(req);
    if (!filePath) return res.status(400).json({ error: 'No path provided' });
    const root = rootFromReq(req);
    const content = await readFile(filePath, root);
    res.json({ path: filePath, content });
  } catch (err: any) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// POST /api/files/mkdir/*?projectId=xxx — create directory
router.post('/mkdir/*', async (req, res) => {
  try {
    const dirPath = paramPath(req);
    if (!dirPath) return res.status(400).json({ error: 'No path provided' });
    const root = rootFromReq(req);
    await createDirectory(dirPath, root);
    console.log(`[files] Created directory: ${dirPath}`);
    res.json({ path: dirPath, success: true });
  } catch (err: any) {
    if (err.message === 'Path traversal denied') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// PUT /api/files/*?projectId=xxx — write file by relative path
router.put('/*', async (req, res) => {
  try {
    const filePath = paramPath(req);
    if (!filePath) return res.status(400).json({ error: 'No path provided' });
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content must be a string' });
    const root = rootFromReq(req);
    await writeFile(filePath, content, root);
    console.log(`[files] Saved: ${filePath} (${content.length} chars)`);
    res.json({ path: filePath, success: true });
  } catch (err: any) {
    console.error(`[files] Save failed — ${err.message}`);
    if (err.message === 'Path traversal denied') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: 'Failed to write file' });
  }
});

export default router;
