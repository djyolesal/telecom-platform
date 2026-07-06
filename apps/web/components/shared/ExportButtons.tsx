'use client';

import { Download, FileText } from 'lucide-react';
import { downloadFile } from '@/lib/download';

/**
 * Paire de boutons d'export Excel + PDF pointant sur la même route
 * (`{base}/xlsx` et `{base}/pdf`) — mêmes colonnes, deux formats.
 */
export function ExportButtons({ base, name, query }: { base: string; name: string; query?: string }) {
  const q = query ? `?${query}` : '';
  const cls =
    'inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50';
  return (
    <>
      <button type="button" onClick={() => downloadFile(`${base}/xlsx${q}`, `${name}.xlsx`)} className={cls}>
        <Download size={15} /> Excel
      </button>
      <button type="button" onClick={() => downloadFile(`${base}/pdf${q}`, `${name}.pdf`)} className={cls}>
        <FileText size={15} /> PDF
      </button>
    </>
  );
}
