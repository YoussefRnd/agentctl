import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { cn } from '@agentctl/ui';

const FONTS = [
  'Geist',
  'Inter',
  'System-ui',
  'San Francisco',
  'Segoe UI',
  'Roboto',
  'Open Sans',
  'Lato',
  'Noto Sans',
  'Ubuntu',
  'Cantarell',
  'Helvetica Neue',
  'Arial',
  'Montserrat',
  'DM Sans',
  'IBM Plex Sans',
  'Public Sans',
  'Space Grotesk',
  'JetBrains Mono',
  'Fira Code',
  'Hack',
  'Cascadia Code',
  'Cascadia Mono',
  'Source Code Pro',
  'Consolas',
  'Monaco',
  'Menlo',
  'Courier New',
  'SF Mono',
  'Berkeley Mono',
  'IBM Plex Mono',
  'Noto Sans Mono',
  'Iosevka',
  'Victor Mono',
  'JetBrains Mono NL',
  'FiraCode Nerd Font Mono',
];

function score(value: string, query: string): number {
  const q = query.toLowerCase();
  const v = value.toLowerCase();
  if (v === q) return 3;
  if (v.startsWith(q)) return 2;
  if (v.includes(q)) return 1;
  return 0;
}

interface FontPickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function FontPicker({ value, onChange, className }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const filtered = query
    ? FONTS.filter((f) => score(f, query) > 0)
        .sort((a, b) => score(b, query) - score(a, query))
        .slice(0, 12)
    : FONTS.slice(0, 12);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) setSelectedIndex(-1);
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, []);

  const select = (font: string) => {
    onChange(font);
    setQuery(font);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') {
        setOpen(true);
        setSelectedIndex(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      select(filtered[selectedIndex]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.preventDefault();
    }
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="border-border text-text-main h-8 w-full rounded-md border bg-transparent px-2.5 font-mono text-[12px] transition-all outline-none focus:border-white/40"
        placeholder="Font name..."
      />
      {open && filtered.length > 0 && (
        <div className="border-border bg-surface z-popover absolute top-full right-0 left-0 mt-1 max-h-48 overflow-y-auto rounded-md border shadow-lg">
          {filtered.map((font, i) => (
            <button
              key={font}
              type="button"
              onMouseDown={() => {
                select(font);
              }}
              onMouseEnter={() => {
                setSelectedIndex(i);
              }}
              className={cn(
                'text-text-main w-full px-3 py-1.5 text-left text-[12px] transition-colors',
                i === selectedIndex ? 'bg-accent/20' : 'hover:bg-white/5',
              )}
            >
              {font}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
