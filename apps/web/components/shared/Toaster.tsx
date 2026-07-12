'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import type { ToastEvent } from '@/lib/toast';

const STYLES = {
  error: { cls: 'border-red-200 bg-red-50 text-red-800', Icon: AlertCircle },
  success: { cls: 'border-green-200 bg-green-50 text-green-800', Icon: CheckCircle2 },
  info: { cls: 'border-gray-200 bg-white text-gray-800', Icon: Info },
};

/** Pile de notifications (coin bas-droit), alimentée par `toast()`. */
export function Toaster() {
  const [items, setItems] = useState<ToastEvent[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastEvent>).detail;
      setItems((prev) => [...prev, detail]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== detail.id)), 6000);
    };
    window.addEventListener('app:toast', onToast);
    return () => window.removeEventListener('app:toast', onToast);
  }, []);

  const dismiss = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {items.map((t) => {
        const { cls, Icon } = STYLES[t.kind];
        return (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${cls}`}>
            <Icon size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
