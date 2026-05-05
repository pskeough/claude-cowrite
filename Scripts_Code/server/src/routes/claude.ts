import { Router } from 'express';
import { sendToClaude } from '../services/claudeService.js';
import { sendToGemini } from '../services/geminiService.js';

const router = Router();

router.post('/', async (req, res) => {
  const {
    mode, message,
    centerPaneFile, leftPaneFile,
    history, model, provider,
    sessionId, // optional: resume a prior session
  } = req.body;

  if (!mode || !message) {
    return res.status(400).json({ error: 'mode and message are required' });
  }

  if (!['analysis', 'context', 'edit'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be analysis, context, or edit' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emit = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  };

  console.log(`[route] AI request: provider=${provider || 'claude'}, mode=${mode}, session=${sessionId ?? 'new'}, message="${message.slice(0, 80)}..."`);

  const abort = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) {
      console.log(`[route] Client disconnected — aborting subprocess`);
      abort.abort();
    }
  });

  try {
    const requestOptions = {
      mode,
      message,
      centerPaneFile,
      leftPaneFile,
      history: Array.isArray(history) ? history : [],
      model: typeof model === 'string' ? model : undefined,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    };

    let response;
    if (provider === 'gemini') {
      // Gemini still uses the old API shape (centerPaneContent injected)
      response = await sendToGemini(
        { ...requestOptions, centerPaneContent: req.body.centerPaneContent, leftPaneContent: req.body.leftPaneContent },
        (event) => emit(event),
        abort.signal,
      );
    } else {
      response = await sendToClaude(requestOptions, (event) => emit(event), abort.signal);
    }

    // Context mode: Claude uses its Write tool to save files directly on disk.
    // No server-side file writing needed here.
    console.log(`[route] AI done: type=${response.type}, session=${(response as any).sessionId ?? 'none'}`);
    emit({ type: 'done', response });
  } catch (err: any) {
    console.error(`[route] AI error:`, err.message);
    emit({ type: 'error', error: err.message || 'AI request failed' });
  } finally {
    res.end();
  }
});

export default router;
