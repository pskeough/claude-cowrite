import { useMemo } from 'react';
import ProseEditor from './ProseEditor';
import DiffView from './DiffView';
import type { FileNode, EditProposal } from '../../types';

interface Props {
  files: FileNode[];
  selectedFile: string | null;
  content: string;
  contentVersion: number;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  editProposal: EditProposal | null;
  onSelectFile: (path: string) => void;
  onContentChange: (content: string) => void;
  onApplyDiff: (finalText: string) => void;
}

function findChaptersDir(nodes: FileNode[]): FileNode | undefined {
  for (const node of nodes) {
    if (node.name === 'Chapters' && node.type === 'directory') return node;
    if (node.children) {
      const found = findChaptersDir(node.children);
      if (found) return found;
    }
  }
  return undefined;
}

function flattenChapterFiles(nodes: FileNode[]): { label: string; path: string }[] {
  const results: { label: string; path: string }[] = [];

  function walk(node: FileNode, parentLabel: string) {
    if (node.type === 'file' && node.name.endsWith('.txt')) {
      results.push({ label: `${parentLabel}/${node.name}`, path: node.path });
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child, node.name);
      }
    }
  }

  const chaptersDir = findChaptersDir(nodes);
  if (chaptersDir?.children) {
    for (const child of chaptersDir.children) {
      walk(child, child.name);
    }
  }

  return results;
}

export default function CenterPane({
  files, selectedFile, content, contentVersion, saveStatus, editProposal,
  onSelectFile, onContentChange, onApplyDiff,
}: Props) {
  const chapterFiles = flattenChapterFiles(files);
  const currentIndex = chapterFiles.findIndex(f => f.path === selectedFile);
  const canNavigate = selectedFile && chapterFiles.length > 1;

  const navigateChapter = (delta: number) => {
    if (!canNavigate) return;
    const newIndex = (currentIndex + delta + chapterFiles.length) % chapterFiles.length;
    onSelectFile(chapterFiles[newIndex].path);
  };

  const wordCount = useMemo(() => {
    if (!content) return 0;
    return content.trim().split(/\s+/).filter(Boolean).length;
  }, [content]);

  return (
    <div className="pane">
      <div className="pane-header">
        Working
        <select
          className="file-select"
          value={selectedFile || ''}
          onChange={e => e.target.value && onSelectFile(e.target.value)}
        >
          <option value="">Select chapter...</option>
          {chapterFiles.map(f => (
            <option key={f.path} value={f.path}>{f.label}</option>
          ))}
        </select>
        {canNavigate && (
          <>
            <button className="nav-arrow" onClick={() => navigateChapter(-1)} title="Previous chapter">&lsaquo;</button>
            <button className="nav-arrow" onClick={() => navigateChapter(1)} title="Next chapter">&rsaquo;</button>
          </>
        )}
        {selectedFile && (
          <span style={{ fontSize: '0.75rem', color: '#999' }}>
            {wordCount.toLocaleString()} words
          </span>
        )}
        <span className={`save-status ${saveStatus}`}>
          {saveStatus === 'saving' && 'Saving...'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Save failed'}
        </span>
      </div>
      <div className="pane-content">
        {editProposal ? (
          <DiffView
            key={editProposal.revisedText.length + editProposal.diffs.length}
            diffs={editProposal.diffs}
            explanation={editProposal.explanation}
            onApplyDiff={onApplyDiff}
          />
        ) : selectedFile ? (
          <ProseEditor key={`${selectedFile}-v${contentVersion}`} content={content} onChange={onContentChange} />
        ) : (
          <div className="empty-state">
            Select a chapter to begin editing
          </div>
        )}
      </div>
    </div>
  );
}
