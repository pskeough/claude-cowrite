import express from 'express';
import cors from 'cors';
import filesRouter from './routes/files.js';
import claudeRouter from './routes/claude.js';
import projectsRouter from './routes/projects.js';
import authRouter from './routes/auth.js';
import chunkedAnalysisRouter from './routes/analysis.js';
import { PORT } from './config.js';

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '5mb' }));

app.use('/api/files', filesRouter);
app.use('/api/ai', claudeRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/auth', authRouter);
app.use('/api/chunked-analysis', chunkedAnalysisRouter);

app.listen(PORT, () => {
  console.log(`AI Book Editor server running on http://localhost:${PORT}`);
});
