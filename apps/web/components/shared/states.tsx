import { Inbox, Loader2, AlertCircle } from 'lucide-react';

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
      <Loader2 size={18} className="animate-spin" />
      {label}
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-9 bg-gray-200 rounded" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-8 bg-gray-100 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title = 'Aucune donnée', hint }: { title?: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Inbox size={32} className="text-gray-300 mb-2" />
      <p className="text-sm font-medium text-gray-500">{title}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message = 'Une erreur est survenue' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AlertCircle size={32} className="text-red-300 mb-2" />
      <p className="text-sm font-medium text-red-500">{message}</p>
    </div>
  );
}
