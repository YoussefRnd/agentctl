import { type FontConfig, DEFAULT_FONT_CONFIG } from '@agentctl/shared';
import { Card, cn } from '@agentctl/ui';
import { Undo2 } from 'lucide-react';
import { FontPicker } from '../../../shared/ui/FontPicker';

interface FontSettingsPanelProps {
  fontConfig: FontConfig | undefined;
  onUpdate: (partial: Partial<FontConfig>) => void;
}

const contextDefs = [
  { key: 'ui', label: 'UI' },
  { key: 'buffer', label: 'Editor' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'chat', label: 'Chat' },
] as const;

export function FontSettingsPanel({ fontConfig, onUpdate }: FontSettingsPanelProps) {
  const fc = fontConfig ?? DEFAULT_FONT_CONFIG;

  const isDefault = (key: keyof FontConfig) => {
    const d = DEFAULT_FONT_CONFIG[key];
    const c = fc[key];
    return c.family === d.family && c.size === d.size;
  };

  const someChanged = !contextDefs.every(({ key }) => isDefault(key));

  return (
    <Card className="px-5 py-4">
      {contextDefs.map(({ key, label }, i) => {
        const ctxKey = key;
        const ctx = fc[ctxKey];
        const def = DEFAULT_FONT_CONFIG[ctxKey];
        const changed = !isDefault(ctxKey);

        return (
          <div
            key={key}
            data-font-ctx={key}
            className={cn(
              'flex items-center gap-3 py-2',
              i < contextDefs.length - 1 && 'border-border/30 border-b',
            )}
          >
            <div className="flex w-16 shrink-0 items-center gap-0.5">
              <span className="text-text-main text-[12px] font-bold">{label}</span>
              <button
                type="button"
                disabled={!changed}
                onClick={() => {
                  onUpdate({ [ctxKey]: { ...def } });
                }}
                title={`Reset to default (${def.family} ${String(def.size)}px)`}
                className="text-text-muted hover:text-text-main disabled:text-text-muted/20 cursor-pointer transition-colors disabled:pointer-events-none disabled:opacity-0"
              >
                <Undo2 className="h-2.5 w-2.5" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <FontPicker
                value={ctx.family}
                onChange={(family) => {
                  onUpdate({ [ctxKey]: { ...ctx, family } });
                }}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={ctx.size <= 8}
                onClick={() => {
                  onUpdate({ [ctxKey]: { ...ctx, size: ctx.size - 1 } });
                }}
                className="border-border text-text-main disabled:text-text-muted/30 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border text-[13px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed"
              >
                −
              </button>
              <span className="text-text-main flex h-7 w-8 items-center justify-center font-mono text-[13px] tabular-nums">
                {ctx.size}
              </span>
              <button
                type="button"
                disabled={ctx.size >= 72}
                onClick={() => {
                  onUpdate({ [ctxKey]: { ...ctx, size: ctx.size + 1 } });
                }}
                className="border-border text-text-main disabled:text-text-muted/30 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border text-[13px] font-bold transition-colors hover:bg-white/5 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
          </div>
        );
      })}
      {someChanged && (
        <div className="flex justify-end pt-3">
          <button
            type="button"
            onClick={() => {
              onUpdate({
                ui: { ...DEFAULT_FONT_CONFIG.ui },
                buffer: { ...DEFAULT_FONT_CONFIG.buffer },
                terminal: { ...DEFAULT_FONT_CONFIG.terminal },
                chat: { ...DEFAULT_FONT_CONFIG.chat },
              });
            }}
            className="text-text-muted hover:text-text-main cursor-pointer text-[10px] font-bold tracking-wider uppercase transition-colors"
          >
            Reset all to defaults
          </button>
        </div>
      )}
    </Card>
  );
}
