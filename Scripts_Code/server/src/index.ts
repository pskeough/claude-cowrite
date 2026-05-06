import express from 'express';
import cors from 'cors';
import filesRouter from './routes/files.js';
import claudeRouter from './routes/claude.js';
import projectsRouter from './routes/projects.js';
import { getProjectContext } from './services/fileService.js';
import { PORT } from './config.js';

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '5mb' }));

// Legacy project context (builtin project)
app.get('/api/project-context', async (_req, res) => {
  try {
    const context = await getProjectContext();
    res.json(context);
  } catch {
    res.status(500).json({ error: 'Failed to get project context' });
  }
});

app.use('/api/files', filesRouter);
app.use('/api/ai', claudeRouter);
app.use('/api/projects', projectsRouter);

app.listen(PORT, () => {
  console.log(`AI Book Editor server running on http://localhost:${PORT}`);
});
