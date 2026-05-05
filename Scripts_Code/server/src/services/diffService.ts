import { diffWords } from 'diff';

export interface DiffChunk {
  type: 'unchanged' | 'insertion' | 'deletion';
  text: string;
}

export function computeWordDiff(original: string, revised: string): DiffChunk[] {
  const changes = diffWords(original, revised);
  const chunks: DiffChunk[] = [];

  for (const change of changes) {
    if (change.added) {
      chunks.push({ type: 'insertion', text: change.value });
    } else if (change.removed) {
      chunks.push({ type: 'deletion', text: change.value });
    } else {
      chunks.push({ type: 'unchanged', text: change.value });
    }
  }

  return chunks;
}
