import { Spinner } from '@agentctl/ui';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Info } from 'lucide-react';
import { useUpdate } from '@/features/updates';

type ToastKind = 'info' | 'success' | 'danger';
type ToastMsg = { kind: ToastKind; text: string } | null;

const STYLES: Record<ToastKind, { border: string; icon: typeof Info; iconColor: string }> = {
  info: { border: 'border-accent/40', icon: Info, iconColor: 'text-accent' },
  success: { border: 'border-success/40', icon: Check, iconColor: 'text-success' },
  danger: { border: 'border-danger/40', icon: AlertTriangle, iconColor: 'text-danger' },
};

export function UpdateToast() {
  const { state } = useUpdate();
  const [toast, setToast] = useState<ToastMsg>(null);
  const prev = useRef(state.status);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const status = state.status;
    if (status === prev.current) return;
    prev.current = status;

    let msg: ToastMsg = null;
    if (status === 'checking') {
      msg = { kind: 'info', text: 'Checking for updates…' };
    } else if (status === 'up-to-date') {
      msg = { kind: 'success', text: "You're up to date" };
    } else if (status === 'error') {
      msg = { kind: 'danger', text: `Update check failed: ${state.message}` };
    } else if (status === 'available') {
      msg = { kind: 'info', text: `Update available: v${state.version}` };
    } else if (status === 'downloaded') {
      msg = { kind: 'success', text: `Update ready — restart to install v${state.version}` };
    }

    if (msg) {
      setToast(msg);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setToast(null);
      }, 4500);
    }
  }, [state]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!toast) return null;
  const { border, icon: Icon, iconColor } = STYLES[toast.kind];

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-[60]">
      <div
        className={`bg-surface/90 border ${border} pointer-events-auto flex items-center gap-2.5 rounded-xl px-4 py-2.5 shadow-2xl backdrop-blur-xl`}
      >
        {toast.kind === 'info' ? (
          <Spinner aria-hidden="true" className={`${iconColor} icon-default`} />
        ) : (
          <Icon className={`${iconColor} h-4 w-4`} />
        )}
        <span className="text-text-main text-[12px] font-medium">{toast.text}</span>
      </div>
    </div>
  );
}
