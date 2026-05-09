import { Router } from 'express';
import {
  runPipeline,
  cancelCurrentPipeline,
  getChunkedAnalysisStatus,
  type AnalysisType,
  type ModelTier,
  type PipelineEvent,
} from '../services/wholeBookAnalysisService.js';

const router = Router();

const VALID_TYPES: AnalysisType[] = ['plot', 'character', 'voice'];
const VALID_MODELS: ModelTier[] = ['haiku', 'sonnet', 'opus'];

/**
 * Chunked whole-book analysis pipeline.
 * Streams progress events via Server-Sent Events.
 *
 * Body: { projectId, analysisTypes, model, chunkSize?, resume? }
 * SSE events: pipeline_start, analysis_type_start/done, chunk_start/done,
 *             tool_call, tool_result, text_delta, cost_info, pipeline_done, error
 */
router.post('/start', async (req, res) => {
  const { projectId, analysisTypes, model, chunkSize, resume } = req.body as {
    projectId?: string;
    analysisTypes?: string[];
    model?: string;
    chunkSize?: number;
    resume?: boolean;
  };

  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  const types = (analysisTypes ?? ['plot', 'character', 'voice'])
    .filter((t): t is AnalysisType => VALID_TYPES.includes(t as AnalysisType));

  if (types.length === 0) {
    res.status(400).json({ error: 'At least one valid analysisType required (plot, character, voice)' });
    return;
  }

  const modelTier: ModelTier = VALID_MODELS.includes(model as ModelTier)
    ? (model as ModelTier)
    : 'sonnet';

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
        projectId,
        analysisTypes: types,
        model: modelTier,
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

router.get('/status/:projectId', async (req, res) => {
  try {
    const status = await getChunkedAnalysisStatus(req.params.projectId);
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
