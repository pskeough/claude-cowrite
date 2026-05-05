import { useState } from 'react';
import FileBrowser from './FileBrowser';
import ProseEditor from '../CenterPane/ProseEditor';
import type { FileNode } from '../../types';
import '../../styles/prose.css';

interface Props {
  files: FileNode[];
  selectedFile: string | null;
  fileContent: string | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  contentVersion: number;
  onSelectFile: (path: string) => void;
  onContentChange: (content: string) => void;
  onCreateFile: (path: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onRefresh: () => void;
}

function getSiblingFiles(nodes: FileNode[], targetPath: string): string[] {
  function findSiblings(nodes: FileNode[]): string[] | null {
    for (const node of nodes) {
      if (node.type === 'file' && node.path === targetPath) {
        return nodes.filter(n => n.type === 'file').map(n => n.path);
      }
      if (node.children) {
        const found = findSiblings(node.children);
        if (found) return found;
      }
    }
    return null;
  }
  return findSiblings(nodes) || [];
}

export default function LeftPane({
  files, selectedFile, fileContent, saveStatus, contentVersion,
  onSelectFile, onContentChange, onCreateFile, onCreateFolder, onRefresh,
}: Props) {
  const [activeTab, setActiveTab] = useState<'explorer' | 'viewer'>('explorer');

  const handleFileClick = (path: string) => {
    onSelectFile(path);
    setActiveTab('viewer');
  };

  const siblings = selectedFile ? getSiblingFiles(files, selectedFile) : [];
  const currentIndex = selectedFile ? siblings.indexOf(selectedFile) : -1;
  const canNavigate = siblings.length > 1;

  const navigateSibling = (delta: number) => {
    if (!canNavigate) return;
    const newIndex = (currentIndex + delta + siblings.length) % siblings.length;
    onSelectFile(siblings[newIndex]);
  };

  return (
    <div className="pane">
      <div className="pane-header">
        <div className="pane-tabs">
          <button
            className={`pane-tab ${activeTab === 'explorer' ? 'active' : ''}`}
            onClick={() => setActiveTab('explorer')}
          >
            Explorer
          </button>
          <button
            className={`pane-tab ${activeTab === 'viewer' ? 'active' : ''}`}
            onClick={() => setActiveTab('viewer')}
          >
            Viewer
          </button>
        </div>
        {activeTab === 'explorer' && (
          <button
            onClick={onRefresh}
            title="Refresh file tree"
            className="nav-arrow"
            style={{ marginLeft: 'auto' }}
          >
            ↺
          </button>
        )}
        {activeTab === 'viewer' && selectedFile && (
          <>
            <span style={{ fontWeight: 400, fontSize: '0.75rem', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {selectedFile.split('/').pop()}
            </span>
            {canNavigate && (
              <>
                <button className="nav-arrow" onClick={() => navigateSibling(-1)} title="Previous file">&lsaquo;</button>
                <button className="nav-arrow" onClick={() => navigateSibling(1)} title="Next file">&rsaquo;</button>
              </>
            )}
            <span className={`save-status ${saveStatus}`} style={{ marginLeft: 'auto' }}>
              {saveStatus === 'saving' && 'Saving...'}
              {saveStatus === 'saved' && 'Saved'}
              {saveStatus === 'error' && 'Save failed'}
            </span>
          </>
        )}
      </div>
      <div className="pane-content">
        {activeTab === 'explorer' ? (
          <FileBrowser
            files={files}
            selectedFile={selectedFile}
            onSelect={handleFileClick}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
          />
        ) : selectedFile && fileContent !== null ? (
          <ProseEditor
            key={`left-${selectedFile}-v${contentVersion}`}
            content={fileContent}
            onChange={onContentChange}
          />
        ) : selectedFile && fileContent === null ? (
          <div className="loading">
            <div className="spinner" />
            Loading...
          </div>
        ) : (
          <div className="empty-state">
            Select a file from Explorer to view
          </div>
        )}
      </div>
    </div>
  );
}
