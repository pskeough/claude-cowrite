import { useState } from 'react';
import ChatWindow from './ChatWindow';
import type { Mode, AIModel, AIProvider, ChatMessage, ProcessEvent } from '../../types';

const CLAUDE_MODELS: { id: AIModel; label: string; note: string }[] = [
  { id: 'claude-opus-4-6',           label: 'Opus 4.6',   note: 'Most capable' },
  { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6', note: 'Balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',  note: 'Fastest' },
];

const GEMINI_MODELS: { id: AIModel; label: string; note: string }[] = [
  { id: 'gemini-2.5-pro',                label: '3.1 Pro',        note: 'Most capable' },
  { id: 'gemini-3-flash-preview',        label: '3.0 Flash',      note: 'Balanced' },
  { id: 'gemini-3.1-flash-lite-preview', label: '3.1 Flash Lite', note: 'Fastest' },
];

interface Props {
  mode: Mode;
  provider: AIProvider;
  model: AIModel;
  messages: ChatMessage[];
  loading: boolean;
  streamingText: string;
  onModeChange: (mode: Mode) => void;
  onProviderChange: (p: AIProvider) => void;
  onModelChange: (model: AIModel) => void;
  onSend: (message: string, onProcess?: (e: ProcessEvent) => void) => void;
  onNewSession: () => void;
}

export default function RightPane({ mode, provider, model, messages, loading, streamingText, onModeChange, onProviderChange, onModelChange, onSend, onNewSession }: Props) {
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
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Provider
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button
              onClick={() => onProviderChange('claude')}
              style={{ flex: 1, padding: '4px 0', border: '1px solid #ccc', borderRadius: 4, background: provider === 'claude' ? '#4a6fa5' : '#fff', color: provider === 'claude' ? '#fff' : '#333', cursor: 'pointer' }}
            >Claude</button>
            <button
              onClick={() => onProviderChange('gemini')}
              style={{ flex: 1, padding: '4px 0', border: '1px solid #ccc', borderRadius: 4, background: provider === 'gemini' ? '#4a6fa5' : '#fff', color: provider === 'gemini' ? '#fff' : '#333', cursor: 'pointer' }}
            >Gemini</button>
          </div>
          <div style={{ fontWeight: 600, marginBottom: 6, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Model
          </div>
          {(provider === 'claude' ? CLAUDE_MODELS : GEMINI_MODELS).map(m => (
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
