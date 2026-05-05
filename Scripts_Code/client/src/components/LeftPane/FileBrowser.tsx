import { useState, useRef, useEffect } from 'react';
import type { FileNode } from '../../types';

interface Props {
  files: FileNode[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
  onCreateFile: (path: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
}

interface CreatingState {
  parentPath: string;
  type: 'file' | 'folder';
}

function CreateInline({ parentPath, type, onCreate, onCancel }: {
  parentPath: string;
  type: 'file' | 'folder';
  onCreate: (path: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let finalName = trimmed;
    if (type === 'file' && !finalName.includes('.')) {
      finalName += '.txt';
    }
    const fullPath = parentPath ? `${parentPath}/${finalName}` : finalName;
    onCreate(fullPath);
  };

  return (
    <div className="file-tree-create">
      <span className="file-tree-create-icon">{type === 'folder' ? '📁' : '📄'}</span>
      <input
        ref={inputRef}
        className="file-tree-create-input"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={onCancel}
        placeholder={type === 'folder' ? 'folder name' : 'filename.txt'}
      />
    </div>
  );
}

function TreeItem({ node, depth, selectedFile, onSelect, creating, onStartCreate, onCreate, onCancelCreate }: {
  node: FileNode;
  depth: number;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  creating: CreatingState | null;
  onStartCreate: (parentPath: string, type: 'file' | 'folder') => void;
  onCreate: (path: string) => void;
  onCancelCreate: () => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (node.type === 'directory') {
    const isCreatingHere = creating && creating.parentPath === node.path;
    return (
      <>
        <div
          className="file-tree-item file-tree-dir"
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="file-tree-toggle">{expanded ? '▾' : '▸'}</span>
          <span style={{ flex: 1 }}>{node.name}</span>
          <span
            className="file-tree-add-btn"
            onClick={e => { e.stopPropagation(); onStartCreate(node.path, 'file'); }}
            title="New file"
          >+</span>
          <span
            className="file-tree-add-btn"
            onClick={e => { e.stopPropagation(); onStartCreate(node.path, 'folder'); }}
            title="New folder"
          >📁+</span>
        </div>
        {expanded && (
          <>
            {isCreatingHere && (
              <div style={{ paddingLeft: 12 + (depth + 1) * 16 }}>
                <CreateInline
                  parentPath={creating!.parentPath}
                  type={creating!.type}
                  onCreate={onCreate}
                  onCancel={onCancelCreate}
                />
              </div>
            )}
            {node.children?.map(child => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                onSelect={onSelect}
                creating={creating}
                onStartCreate={onStartCreate}
                onCreate={onCreate}
                onCancelCreate={onCancelCreate}
              />
            ))}
          </>
        )}
      </>
    );
  }

  return (
    <div
      className={`file-tree-item${selectedFile === node.path ? ' selected' : ''}`}
      style={{ paddingLeft: 12 + depth * 16 }}
      onClick={() => onSelect(node.path)}
    >
      <span className="file-tree-toggle" />
      {node.name}
    </div>
  );
}

export default function FileBrowser({ files, selectedFile, onSelect, onCreateFile, onCreateFolder }: Props) {
  const [creating, setCreating] = useState<CreatingState | null>(null);

  const handleStartCreate = (parentPath: string, type: 'file' | 'folder') => {
    setCreating({ parentPath, type });
  };

  const handleCreate = async (path: string) => {
    if (creating?.type === 'folder') {
      await onCreateFolder(path);
    } else {
      await onCreateFile(path);
    }
    setCreating(null);
  };

  return (
    <div className="file-tree">
      <div className="file-tree-toolbar">
        <span
          className="file-tree-add-btn file-tree-add-root"
          onClick={() => setCreating({ parentPath: '', type: 'file' })}
          title="New file at root"
        >+ File</span>
        <span
          className="file-tree-add-btn file-tree-add-root"
          onClick={() => setCreating({ parentPath: '', type: 'folder' })}
          title="New folder at root"
        >+ Folder</span>
      </div>
      {creating && creating.parentPath === '' && (
        <div style={{ paddingLeft: 12 }}>
          <CreateInline
            parentPath=""
            type={creating.type}
            onCreate={handleCreate}
            onCancel={() => setCreating(null)}
          />
        </div>
      )}
      {files.map(node => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedFile={selectedFile}
          onSelect={onSelect}
          creating={creating}
          onStartCreate={handleStartCreate}
          onCreate={handleCreate}
          onCancelCreate={() => setCreating(null)}
        />
      ))}
    </div>
  );
}
