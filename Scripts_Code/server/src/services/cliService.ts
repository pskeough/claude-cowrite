import { spawn } from 'child_process';

const MODEL_IDS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-6',
} as const;

/**
 * Run a single-shot prompt through the claude CLI.
 * Returns the text result. Throws on non-zero exit or CLI error.
 */
export async function claudeCli(
  prompt: string,
  model: 'haiku' | 'sonnet' | 'opus' = 'sonnet',
  timeoutMs: number = 120_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const modelId = MODEL_IDS[model];
    const proc = spawn('claude', [
      '-p', prompt,
      '--output-format', 'json',
      '--model', modelId,
      '--dangerously-skip-permissions',
    ], { shell: true });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`claude CLI timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
        if (parsed.is_error) {
          return reject(new Error(String(parsed.result ?? 'claude CLI returned error')));
        }
        resolve(String(parsed.result ?? ''));
      } catch {
        // Not JSON — return raw stdout (shouldn't happen with --output-format json)
        resolve(stdout.trim());
      }
    });

    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude: ${e.message}`));
    });
  });
}

export interface AuthStatus {
  installed: boolean;
  version?: string;
  error?: string;
}

export async function checkClaudeAuth(): Promise<AuthStatus> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--version'], { shell: true });
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ installed: true, version: stdout.trim() });
      } else {
        resolve({ installed: false, error: 'claude not found in PATH' });
      }
    });
    proc.on('error', (e) => {
      resolve({ installed: false, error: e.message });
    });
    setTimeout(() => {
      proc.kill();
      resolve({ installed: false, error: 'timeout checking claude version' });
    }, 5000);
  });
}
