import express from 'express';
import cors from 'cors';
import filesRouter from './routes/files.js';
import claudeRouter from './routes/claude.js';
import analysisRouter from './routes/analysis.js';
import { getProjectContext } from './services/fileService.js';
import { PORT } from './config.js';

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '5mb' }));

// Project context at top level — must not be nested under /api/files wildcard
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
app.use('/api/analysis', analysisRouter);

app.listen(PORT, () => {
  console.log(`Basilisk Editor server running on http://localhost:${PORT}`);
});
