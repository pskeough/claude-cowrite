import { useState } from 'react';
import ChatWindow from './ChatWindow';
import type { Mode, AIModel, ChatMessage, ProcessEvent } from '../../types';

const CLAUDE_MODELS: { id: AIModel; label: string; note: string }[] = [
  { id: 'claude-opus-4-6',           label: 'Opus 4.6',   note: 'Most capable' },
  { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6', note: 'Balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',  note: 'Fastest' },
];

interface Props {
  mode: Mode;
  model: AIModel;
  messages: ChatMessage[];
  loading: boolean;
  streamingText: string;
  onModeChange: (mode: Mode) => void;
  onModelChange: (model: AIModel) => void;
  onSend: (message: string, onProcess?: (e: ProcessEvent) => void) => void;
  onNewSession: () => void;
}

export default function RightPane({ mode, model, messages, loading, streamingText, onModeChange, onModelChange, onSend, onNewSession }: Props) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="pane">
      <div className="pane-header">
        Claude
        <button
          className="dark-toggle"
          onClick={() => setShowSettings(s => !s)}
          title="Model settings"
          style={{ marginLeft: 'auto' }}
        >
          ⚙
        </button>
      </div>

      {showSettings && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #e0ddd8', background: '#f5f3ef', fontSize: '0.8rem' }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Model
          </div>
          {CLAUDE_MODELS.map(m => (
            <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', color: model === m.id ? '#1a1a1a' : '#666' }}>
              <input
                type="radio"
                name="model"
                value={m.id}
                checked={model === m.id}
                onChange={() => onModelChange(m.id)}
                style={{ accentColor: '#4a6fa5' }}
              />
              <span style={{ fontWeight: model === m.id ? 600 : 400 }}>{m.label}</span>
              <span style={{ color: '#999', fontSize: '0.75rem' }}>{m.note}</span>
            </label>
          ))}
        </div>
      )}

      <ChatWindow
        messages={messages}
        loading={loading}
        streamingText={streamingText}
        mode={mode}
        onModeChange={onModeChange}
        onSend={onSend}
        onNewSession={onNewSession}
      />
    </div>
  );
}
