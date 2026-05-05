import type { Mode } from '../../types';

interface Props {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

const MODES: { value: Mode; label: string }[] = [
  { value: 'analysis', label: 'Analysis' },
  { value: 'context', label: 'Context' },
  { value: 'edit', label: 'Edit' },
];

export default function ModeSelector({ mode, onChange }: Props) {
  return (
    <div className="mode-selector">
      {MODES.map(m => (
        <button
          key={m.value}
          className={`mode-btn${mode === m.value ? ' active' : ''}`}
          onClick={() => onChange(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
