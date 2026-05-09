import { Router } from 'express';
import {
  runPipeline,
  cancelCurrentPipeline,
  getAnalysisStatus,
  type AnalysisType,
  type PipelineEvent,
} from '../services/wholeBookAnalysisService.js';

const router = Router();

router.post('/start', async (req, res) => {
  const { manuscriptPath, analysisTypes, model, chunkSize, resume } = req.body as {
    manuscriptPath: string;
    analysisTypes?: string[];
    model?: string;
    chunkSize?: number;
    resume?: boolean;
  };

  if (!manuscriptPath) {
    res.status(400).json({ error: 'manuscriptPath is required' });
    return;
  }

  const types: AnalysisType[] = (analysisTypes ?? ['plot', 'character', 'voice']).filter(
    (t): t is AnalysisType => ['plot', 'character', 'voice'].includes(t)
  );

  if (types.length === 0) {
    res.status(400).json({ error: 'At least one valid analysisType required (plot, character, voice)' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = (event: PipelineEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    await runPipeline(
      {
        manuscriptPath,
        analysisTypes: types,
        model: model ?? 'claude-sonnet-4-6',
        chunkSize: chunkSize ?? 40_000,
        resume: resume ?? false,
      },
      emit,
    );
  } catch (err: any) {
    emit({ type: 'error', error: err.message, recoverable: false });
  } finally {
    res.end();
  }
});

router.get('/status', async (_req, res) => {
  try {
    const status = await getAnalysisStatus();
    if (!status) {
      res.status(404).json(null);
      return;
    }
    res.json(status);
  } catch {
    res.status(500).json({ error: 'Failed to read analysis status' });
  }
});

router.delete('/cancel', (_req, res) => {
  cancelCurrentPipeline();
  res.json({ ok: true });
});

export default router;
