import { Router } from 'express';
import { sendToClaude } from '../services/claudeService.js';
import { sendToGemini } from '../services/geminiService.js';
import { runDirectEdit } from '../services/claudeDirectService.js';
import { getBookRoot } from '../config.js';
import { getProject } from '../services/projectService.js';

const router = Router();

router.post('/', async (req, res) => {
  const {
    mode, message,
    centerPaneFile, leftPaneFile,
    history, model, provider,
    sessionId,
    directMode,
    projectId,    // optional: scope file I/O to this project
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

  const abort = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) {
      console.log(`[route] Client disconnected — aborting`);
      abort.abort();
    }
  });

  // Resolve project context
  const bookRoot = getBookRoot(projectId);
  let bookTitle = 'The Basilisk';
  if (projectId && projectId !== 'builtin') {
    try {
      const project = await getProject(projectId);
      bookTitle = project.bookTitle || project.name;
    } catch {
      // project not found, use default
    }
  }

  const projectOptions = { bookRoot, bookTitle, projectId };

  console.log(`[route] AI: provider=${provider || 'claude'}, mode=${mode}, project=${projectId ?? 'builtin'}, session=${sessionId ?? 'new'}, msg="${message.slice(0, 60)}..."`);

  try {
    const requestOptions = {
      mode,
      message,
      centerPaneFile,
      leftPaneFile,
      history: Array.isArray(history) ? history : [],
      model: typeof model === 'string' ? model : undefined,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      projectOptions,
    };

    let response;
    if (provider === 'gemini') {
      response = await sendToGemini(
        { ...requestOptions, centerPaneContent: req.body.centerPaneContent, leftPaneContent: req.body.leftPaneContent },
        (event) => emit(event),
        abort.signal,
      );
    } else if (mode === 'edit' && directMode && centerPaneFile) {
      const result = await runDirectEdit(
        {
          message,
          centerPaneFile,
          bookRoot,
          bookTitle,
          model: model === 'claude-opus-4-6' ? 'opus' : 'sonnet',
        },
        (event) => emit(event),
      );
      response = result;
    } else {
      response = await sendToClaude(requestOptions, (event) => emit(event), abort.signal);
    }

    console.log(`[route] Done: type=${response.type}, session=${(response as any).sessionId ?? 'none'}`);
    emit({ type: 'done', response });
  } catch (err: any) {
    console.error(`[route] AI error:`, err.message);
    emit({ type: 'error', error: err.message || 'AI request failed' });
  } finally {
    res.end();
  }
});

export default router;
