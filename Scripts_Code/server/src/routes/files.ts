import { Router } from 'express';
import { listFiles, readFile, writeFile, createDirectory } from '../services/fileService.js';

const router = Router();

// GET /api/files — full file tree
router.get('/', async (_req, res) => {
  try {
    const tree = await listFiles();
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// GET /api/files/* — read file by relative path
router.get('/*', async (req, res) => {
  try {
    const filePath = req.params[0];
    if (!filePath) return res.status(400).json({ error: 'No path provided' });
    const content = await readFile(filePath);
    res.json({ path: filePath, content });
  } catch (err: any) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// POST /api/files/mkdir/* — create directory
router.post('/mkdir/*', async (req, res) => {
  try {
    const dirPath = req.params[0];
    if (!dirPath) return res.status(400).json({ error: 'No path provided' });
    await createDirectory(dirPath);
    console.log(`[files] Created directory: ${dirPath}`);
    res.json({ path: dirPath, success: true });
  } catch (err: any) {
    if (err.message === 'Path traversal denied') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// PUT /api/files/* — write file by relative path
router.put('/*', async (req, res) => {
  try {
    const filePath = req.params[0];
    if (!filePath) return res.status(400).json({ error: 'No path provided' });
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content must be a string' });
    await writeFile(filePath, content);
    console.log(`[files] Saved: ${filePath} (${content.length} chars)`);
    res.json({ path: filePath, success: true });
  } catch (err: any) {
    console.error(`[files] Save failed: ${req.params[0]} — ${err.message}`);
    if (err.message === 'Path traversal denied') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: 'Failed to write file' });
  }
});

export default router;
