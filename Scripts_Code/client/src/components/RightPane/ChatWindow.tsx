import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage, Mode, ProcessEvent } from '../../types';

const MODES: { value: Mode; label: string }[] = [
  { value: 'analysis', label: 'Analysis' },
  { value: 'context', label: 'Context' },
  { value: 'edit', label: 'Edit' },
];

const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Glob: '🔍',
  Grep: '🔍',
  Bash: '💻',
  Write: '✏️',
  Edit: '✏️',
};

function formatToolInput(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Read' && input.file_path) return String(input.file_path);
  if ((tool === 'Glob') && input.pattern) return String(input.pattern);
  if (tool === 'Grep' && input.pattern) return `"${input.pattern}"`;
  if (tool === 'Bash' && input.command) {
    const cmd = String(input.command);
    return cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd;
  }
  const first = Object.values(input)[0];
  return first ? String(first).slice(0, 60) : '';
}

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  streamingText: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onSend: (message: string, onProcess?: (e: ProcessEvent) => void) => void;
  onNewSession: () => void;
}

export default function ChatWindow({ messages, loading, streamingText, mode, onModeChange, onSend, onNewSession }: Props) {
  const [input, setInput] = useState('');
  const [processLog, setProcessLog] = useState<ProcessEvent[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  // Paragraph-reveal state for when text arrives as one block
  const [visibleParas, setVisibleParas] = useState(0);
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStreamingText = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, processLog, streamingText]);

  // When streaming text changes, drip paragraphs out one at a time
  useEffect(() => {
    const prev = prevStreamingText.current;
    prevStreamingText.current = streamingText;

    if (!streamingText) {
      setVisibleParas(0);
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
      return;
    }

    const paras = streamingText.split(/\n\s*\n/).filter(Boolean);

    // If text jumped from empty to many paragraphs at once, reveal gradually
    if (!prev && paras.length > 1) {
      setVisibleParas(1);
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
      revealTimerRef.current = setInterval(() => {
        setVisibleParas(v => {
          if (v >= paras.length) {
            clearInterval(revealTimerRef.current!);
            return v;
          }
          return v + 1;
        });
      }, 120);
    } else {
      // Incremental streaming — show everything received so far
      setVisibleParas(paras.length);
    }
  }, [streamingText]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setProcessLog([]);
    setLogExpanded(true);
    onSend(trimmed, (evt) => setProcessLog(prev => [...prev, evt]));
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Collapse log when response arrives (loading goes false)
  const prevLoading = useRef(loading);
  useEffect(() => {
    if (prevLoading.current && !loading) {
      setLogExpanded(false);
    }
    prevLoading.current = loading;
  }, [loading]);

  const toolCalls = processLog.filter(e => e.type === 'tool_call');

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="empty-state">Send a message to begin</div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            {msg.role === 'assistant'
              ? <ReactMarkdown>{msg.content}</ReactMarkdown>
              : msg.content
            }
          </div>
        ))}

        {/* Process log — visible during loading or after if tools were called */}
        {(loading || toolCalls.length > 0) && (
          <div className="process-log">
            <button className="process-log-toggle" onClick={() => setLogExpanded(e => !e)}>
              <span className="process-log-arrow">{logExpanded ? '▼' : '▶'}</span>
              {loading && !streamingText
                ? `Working…${toolCalls.length > 0 ? ` (${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''})` : ''}`
                : `${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''}`
              }
              {loading && !streamingText && <span className="process-spinner" />}
            </button>

            {logExpanded && (
              <div className="process-log-entries">
                {processLog.map((evt, i) => {
                  if (evt.type === 'tool_call') {
                    const icon = TOOL_ICONS[evt.tool ?? ''] ?? '⚙️';
                    const detail = evt.input ? formatToolInput(evt.tool ?? '', evt.input) : '';
                    return (
                      <div key={i} className="process-entry process-entry-call">
                        <span className="process-icon">{icon}</span>
                        <span className="process-tool">{evt.tool}</span>
                        {detail && <span className="process-detail">{detail}</span>}
                      </div>
                    );
                  }
                  if (evt.type === 'tool_result') {
                    return (
                      <div key={i} className={`process-entry process-entry-result${evt.isError ? ' process-entry-error' : ''}`}>
                        <span className="process-icon">{evt.isError ? '✗' : '✓'}</span>
                        <span className="process-tool">{evt.tool}</span>
                        <span className="process-detail">{evt.isError ? 'error' : 'ok'}</span>
                      </div>
                    );
                  }
                  if (evt.type === 'cost_info') {
                    const parts: string[] = [];
                    if (evt.durationMs != null) parts.push(`${(evt.durationMs / 1000).toFixed(1)}s`);
                    if (evt.numTurns != null) parts.push(`${evt.numTurns} turns`);
                    if (evt.costUsd != null) parts.push(`$${evt.costUsd.toFixed(4)}`);
                    return (
                      <div key={i} className="process-entry process-entry-cost">
                        <span className="process-icon">💰</span>
                        <span className="process-detail">{parts.join(' · ')}</span>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </div>
        )}

        {/* Live streaming response bubble */}
        {streamingText && (() => {
          const paras = streamingText.split(/\n\s*\n/).filter(Boolean);
          const shown = paras.slice(0, visibleParas);
          return (
            <div className="chat-message assistant streaming-message">
              <ReactMarkdown>{shown.join('\n\n')}</ReactMarkdown>
              <span className="streaming-cursor" />
            </div>
          );
        })()}

        <div ref={messagesEndRef} />
      </div>

      {/* Mode bar + New Chat — always visible above input */}
      <div className="chat-controls">
        <div className="mode-selector">
          {MODES.map(m => (
            <button
              key={m.value}
              className={`mode-btn${mode === m.value ? ' active' : ''}`}
              onClick={() => onModeChange(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button className="dark-toggle new-chat-btn" onClick={onNewSession} title="New session">
          New Chat
        </button>
      </div>

      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Message Claude…"
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
