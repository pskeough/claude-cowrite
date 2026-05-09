import { Router } from 'express';
import { spawn } from 'child_process';
import { checkClaudeAuth } from '../services/cliService.js';

const router = Router();

// GET /api/auth/status — check if claude CLI is installed and accessible
router.get('/status', async (_req, res) => {
  const status = await checkClaudeAuth();
  res.json(status);
});

// POST /api/auth/login — open a new terminal window running claude to trigger auth flow
router.post('/login', (_req, res) => {
  try {
    spawn('cmd', ['/c', 'start', 'cmd', '/k', 'echo Authenticating Claude Code... && claude'], {
      shell: false,
      detached: true,
      stdio: 'ignore',
    }).unref();
    res.json({ launched: true, message: 'A terminal window has opened. Complete sign-in there, then return here.' });
  } catch (err: any) {
    res.status(500).json({ launched: false, error: err.message });
  }
});

// POST /api/auth/install — install the Claude Code CLI globally via npm
router.post('/install', (_req, res) => {
  const child = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

  const timer = setTimeout(() => {
    child.kill();
    if (!res.headersSent) {
      res.status(504).json({ installed: false, error: 'Install timed out after 5 minutes' });
    }
  }, 5 * 60_000);

  child.on('close', (code) => {
    clearTimeout(timer);
    if (res.headersSent) return;
    if (code === 0) {
      res.json({ installed: true, message: 'Claude Code installed. Click Sign In to authenticate.' });
    } else {
      res.status(500).json({ installed: false, error: stderr.slice(0, 1000) || `npm exited with code ${code}` });
    }
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    if (res.headersSent) return;
    res.status(500).json({ installed: false, error: err.message });
  });
});

export default router;
