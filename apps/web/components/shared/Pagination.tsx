import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function Pagination({ meta, onChange }: { meta?: PaginationMeta; onChange: (page: number) => void }) {
  if (!meta || meta.total === 0) return null;
  const start = (meta.page - 1) * meta.limit + 1;
  const end = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="flex items-center justify-between px-1 py-3 text-xs text-gray-500">
      <span>
        {start}–{end} sur {meta.total.toLocaleString('fr-FR')}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(meta.page - 1)}
          disabled={!meta.hasPrev}
          className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={14} /> Préc.
        </button>
        <span className="px-2 font-medium text-gray-600">
          {meta.page} / {meta.totalPages}
        </span>
        <button
          onClick={() => onChange(meta.page + 1)}
          disabled={!meta.hasNext}
          className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Suiv. <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
