import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  getProjectPaths,
} from '../services/projectService.js';
import { splitBookIntoChapters } from '../services/splitService.js';
import { queueAnalysis, getProgress } from '../services/analysisQueueService.js';
import type { AnalysisOptions } from '../services/analysisQueueService.js';

const router = Router();

// Multer: store uploads in memory, then we write them ourselves
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'text/plain' || file.originalname.endsWith('.txt');
    cb(null, ok);
  },
});

// GET /api/projects
router.get('/', async (_req, res) => {
  try {
    const projects = await listProjects();
    res.json(projects);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id
router.get('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const project = await getProject(id);
    const progress = getProgress(id);
    res.json({ ...project, progress: progress ?? null });
  } catch (err: any) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Project not found' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects — create a new project
router.post('/', async (req, res) => {
  try {
    const { name, description, bookTitle, author, analysisConfig } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    const project = await createProject({
      name: name.trim(),
      description: description?.trim(),
      bookTitle: bookTitle?.trim() || name.trim(),
      author: author?.trim(),
      analysisConfig: {
        splitChapters:    Boolean(analysisConfig?.splitChapters),
        plotAnalysis:     Boolean(analysisConfig?.plotAnalysis),
        characterProfiles: Boolean(analysisConfig?.characterProfiles),
        voiceContext:     Boolean(analysisConfig?.voiceContext),
        model:            ['haiku', 'sonnet', 'opus'].includes(analysisConfig?.model) ? analysisConfig.model : 'sonnet',
      },
    });
    console.log(`[projects] Created: ${project.id} "${project.name}"`);
    res.status(201).json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id — update project metadata
router.patch('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const { name, description, bookTitle, author } = req.body;
    const updated = await updateProject(id, {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(bookTitle && { bookTitle }),
      ...(author !== undefined && { author }),
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/upload — upload a raw book .txt file
router.post('/:id/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided. Attach a .txt file as "file" field.' });

    const id = String(req.params.id);
    const paths = getProjectPaths(id);
    const filename = (req.file.originalname || 'book.txt').replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = path.join(paths.rawFiles, filename);

    await fs.writeFile(destPath, req.file.buffer, 'utf-8');
    await updateProject(id, { rawFile: filename });

    console.log(`[projects] Uploaded ${filename} (${req.file.size} bytes) to project ${id}`);
    res.json({ filename, size: req.file.size, path: destPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/split — detect chapter structure and split into files
router.post('/:id/split', async (req, res) => {
  try {
    const id = String(req.params.id);
    const project = await getProject(id);
    const paths = getProjectPaths(id);

    // Determine which raw file to split
    let rawFilePath: string;
    const reqFilename = typeof req.body.filename === 'string' ? req.body.filename : null;
    if (reqFilename) {
      rawFilePath = path.join(paths.rawFiles, reqFilename);
    } else if (project.rawFile) {
      rawFilePath = path.join(paths.rawFiles, project.rawFile);
    } else {
      // Try to find any .txt in RawFiles
      const rawFiles = (await fs.readdir(paths.rawFiles)).filter(f => f.endsWith('.txt'));
      if (rawFiles.length === 0) return res.status(400).json({ error: 'No raw file found. Upload a .txt file first.' });
      rawFilePath = path.join(paths.rawFiles, rawFiles[0]);
    }

    const modelRaw = typeof req.body.model === 'string' ? req.body.model : 'sonnet';
    const model = (['haiku', 'sonnet', 'opus'] as const).includes(modelRaw as 'haiku' | 'sonnet' | 'opus')
      ? (modelRaw as 'haiku' | 'sonnet' | 'opus')
      : 'sonnet' as const;

    console.log(`[projects] Splitting ${rawFilePath} for project ${id}`);
    const result = await splitBookIntoChapters(id, rawFilePath, model);

    res.json(result);
  } catch (err: any) {
    console.error(`[projects] Split error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/analyze — queue background analysis jobs
router.post('/:id/analyze', async (req, res) => {
  try {
    const id = String(req.params.id);
    const { plotAnalysis, characterProfiles, voiceContext, model } = req.body;
    const modelStr = typeof model === 'string' ? model : 'sonnet';
    const options: AnalysisOptions = {
      plotAnalysis:     Boolean(plotAnalysis),
      characterProfiles: Boolean(characterProfiles),
      voiceContext:     Boolean(voiceContext),
      model:            (['haiku', 'sonnet', 'opus'] as const).includes(modelStr as 'haiku' | 'sonnet' | 'opus') ? (modelStr as 'haiku' | 'sonnet' | 'opus') : 'sonnet',
    };

    if (!options.plotAnalysis && !options.characterProfiles && !options.voiceContext) {
      return res.status(400).json({ error: 'At least one analysis type must be selected.' });
    }

    queueAnalysis(id, options);
    console.log(`[projects] Queued analysis for ${id}:`, options);
    res.json({ queued: true, options });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/files — list files within a project (delegates to fileService)
// Handled in routes/files.ts via ?projectId= query param

export default router;
