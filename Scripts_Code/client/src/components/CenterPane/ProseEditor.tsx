import { useRef, useEffect, useCallback } from 'react';
import '../../styles/prose.css';

interface Props {
  content: string;        // initial value only — component is uncontrolled
  onChange: (content: string) => void;
}

export default function ProseEditor({ content, onChange }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resize once on mount (file load). Keystroke resizing handled in onChange.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    // Preserve scroll position — setting height:auto collapses the textarea
    // momentarily, causing the scroll container to jump to the cursor
    const container = el.parentElement;
    const savedScroll = container?.scrollTop ?? 0;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    if (container) container.scrollTop = savedScroll;
    onChange(el.value);
  }, [onChange]);

  return (
    <textarea
      ref={textareaRef}
      className="prose-editor"
      defaultValue={content}
      onChange={handleChange}
      spellCheck
    />
  );
}
