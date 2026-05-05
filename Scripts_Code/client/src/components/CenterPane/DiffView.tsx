import { useState, useMemo, useCallback } from 'react';
import type { DiffChunk } from '../../types';
import '../../styles/prose.css';

interface Hunk {
  id: number;
  type: 'unchanged' | 'change';
  original: string;
  revised: string;
  status: 'pending' | 'accepted' | 'rejected';
}

function buildHunks(diffs: DiffChunk[]): Hunk[] {
  const hunks: Hunk[] = [];
  let id = 0;
  let i = 0;
  while (i < diffs.length) {
    if (diffs[i].type === 'unchanged') {
      hunks.push({ id: id++, type: 'unchanged', original: diffs[i].text, revised: diffs[i].text, status: 'pending' });
      i++;
    } else {
      let original = '';
      let revised = '';
      while (i < diffs.length && diffs[i].type !== 'unchanged') {
        if (diffs[i].type === 'deletion') original += diffs[i].text;
        else if (diffs[i].type === 'insertion') revised += diffs[i].text;
        i++;
      }
      hunks.push({ id: id++, type: 'change', original, revised, status: 'pending' });
    }
  }
  return hunks;
}

function computeFinalText(hunks: Hunk[], pendingFallback: 'original' | 'revised' = 'revised'): string {
  return hunks.map(h => {
    if (h.type === 'unchanged') return h.original;
    if (h.status === 'accepted') return h.revised;
    if (h.status === 'rejected') return h.original;
    return pendingFallback === 'revised' ? h.revised : h.original;
  }).join('');
}

interface Props {
  diffs: DiffChunk[];
  explanation: string;
  onApplyDiff: (finalText: string) => void;
}

export default function DiffView({ diffs, explanation, onApplyDiff }: Props) {
  const [hunks, setHunks] = useState<Hunk[]>(() => buildHunks(diffs));

  const changeHunks = hunks.filter(h => h.type === 'change');
  const total = changeHunks.length;
  const accepted = changeHunks.filter(h => h.status === 'accepted').length;
  const rejected = changeHunks.filter(h => h.status === 'rejected').length;
  const pending = total - accepted - rejected;

  const originalText = useMemo(() => hunks.map(h => h.original).join(''), [hunks]);

  const setStatus = useCallback((id: number, status: Hunk['status']) => {
    setHunks(prev => prev.map(h => h.id === id ? { ...h, status } : h));
  }, []);

  const acceptAll = () => setHunks(prev => prev.map(h => h.type === 'change' ? { ...h, status: 'accepted' } : h));

  return (
    <div className="diff-container">

      {/* Sticky toolbar */}
      <div className="diff-toolbar">
        <span className="diff-stats">
          {total} change{total !== 1 ? 's' : ''}
          {accepted > 0 && <span className="diff-stat diff-stat-accepted"> · {accepted} accepted</span>}
          {rejected > 0 && <span className="diff-stat diff-stat-rejected"> · {rejected} skipped</span>}
          {pending > 0 && <span className="diff-stat diff-stat-pending"> · {pending} pending</span>}
        </span>
        <div className="diff-toolbar-actions">
          <button className="diff-btn diff-btn-accept-all" onClick={acceptAll} title="Mark all changes as accepted">
            Accept all
          </button>
          <button
            className="diff-btn diff-btn-apply"
            onClick={() => onApplyDiff(computeFinalText(hunks, 'revised'))}
            title={pending > 0 ? `Apply — ${pending} pending will be accepted` : 'Apply accepted changes'}
          >
            Apply{pending > 0 ? ` (${pending} pending → ✓)` : ''}
          </button>
          <button
            className="diff-btn diff-btn-discard"
            onClick={() => onApplyDiff(originalText)}
            title="Discard all — restore original"
          >
            Revert all
          </button>
        </div>
      </div>

      {/* Explanation */}
      {explanation && (
        <div className="diff-explanation-bar">{explanation}</div>
      )}

      {/* Prose with inline per-change controls */}
      <div className="diff-prose">
        {hunks.map(hunk => {
          if (hunk.type === 'unchanged') {
            return <span key={hunk.id}>{hunk.original}</span>;
          }

          if (hunk.status === 'pending') {
            return (
              <span key={hunk.id} className="diff-hunk diff-hunk-pending">
                {hunk.original && <del className="diff-del">{hunk.original}</del>}
                {hunk.revised && <ins className="diff-ins">{hunk.revised}</ins>}
                <span className="diff-inline-controls">
                  <button
                    className="diff-ctrl diff-ctrl-accept"
                    onClick={() => setStatus(hunk.id, 'accepted')}
                    title="Accept this change"
                  >✓</button>
                  <button
                    className="diff-ctrl diff-ctrl-reject"
                    onClick={() => setStatus(hunk.id, 'rejected')}
                    title="Skip this change (keep original)"
                  >✗</button>
                </span>
              </span>
            );
          }

          if (hunk.status === 'accepted') {
            return (
              <span key={hunk.id} className="diff-hunk diff-hunk-accepted">
                <ins className="diff-ins-done">{hunk.revised}</ins>
                <button
                  className="diff-ctrl diff-ctrl-undo"
                  onClick={() => setStatus(hunk.id, 'pending')}
                  title="Undo decision"
                >↩</button>
              </span>
            );
          }

          // rejected
          return (
            <span key={hunk.id} className="diff-hunk diff-hunk-rejected">
              <span className="diff-del-done">{hunk.original || <span className="diff-empty">[deleted]</span>}</span>
              <button
                className="diff-ctrl diff-ctrl-undo"
                onClick={() => setStatus(hunk.id, 'pending')}
                title="Undo decision"
              >↩</button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
