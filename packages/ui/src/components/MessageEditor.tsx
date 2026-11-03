import { Spinner } from './Spinner.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../primitives/Button/index.js';
import { cn } from '../utils.js';

export function MessageEditor({
  initialValue,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
  label = 'Edit message',
  className,
}: {
  initialValue: string;
  onSubmit: (value: string) => void | boolean | Promise<void | boolean>;
  onCancel: () => void;
  submitLabel?: 'Save' | 'Send';
  label?: string;
  className?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 280)}px`;
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);

  const save = async () => {
    if (savingRef.current || !value.trim() || value.trim() === initialValue.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await onSubmit(value.trim());
      if (result === false) setError('Could not save changes. Try again.');
      else onCancel();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save changes. Try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        'motion-editor border-border/20 bg-surface-tertiary/60 w-full min-w-0 rounded-lg border p-4 tracking-normal',
        className,
      )}
    >
      <textarea
        ref={textareaRef}
        aria-label={label}
        value={value}
        readOnly={saving}
        rows={1}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!savingRef.current) onCancel();
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
        className="text-role-body text-text-main block max-h-70 min-h-11 w-full resize-none bg-transparent [font-size:inherit] leading-relaxed [overflow-wrap:anywhere] outline-none"
      />
      {error && (
        <p role="alert" className="text-danger mt-2 text-xs [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      <div className="mt-3 flex min-h-8 items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="default"
          disabled={saving}
          aria-label="Cancel editing"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="default"
          aria-busy={saving || undefined}
          disabled={saving || !value.trim() || value.trim() === initialValue.trim()}
          onClick={() => void save()}
        >
          {saving && <Spinner aria-hidden="true" className="icon-compact" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
