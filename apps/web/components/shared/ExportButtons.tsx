'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileText, SlidersHorizontal, X } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';

interface ColonneDispo { key: string; header: string }

/**
 * Boutons d'export Excel + PDF pointant sur la même route (`{base}/xlsx` et
 * `{base}/pdf`) — mêmes colonnes, deux formats — avec un sélecteur de colonnes :
 * la liste disponible est fournie par l'API (`?colonnes=?`), les colonnes
 * décochées sont exclues de l'export (`?colonnes=cle1,cle2`).
 */
export function ExportButtons({ base, name, query }: { base: string; name: string; query?: string }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colonnes, setColonnes] = useState<ColonneDispo[] | null>(null);
  const [exclues, setExclues] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const q = query ? `?${query}` : '';
  const cls =
    'inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50';

  // Fermer le panneau au clic extérieur.
  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [pickerOpen]);

  const ouvrirPicker = async () => {
    if (pickerOpen) { setPickerOpen(false); return; }
    setPickerOpen(true);
    if (colonnes == null) {
      setLoading(true);
      try {
        const r = await api.get(`${base}/xlsx${q}${q ? '&' : '?'}colonnes=%3F`);
        // Fusionne les feuilles (exports multi-feuilles) en dédupliquant par clé.
        const vues = new Map<string, ColonneDispo>();
        for (const feuille of r.data.data as { colonnes: ColonneDispo[] }[]) {
          for (const c of feuille.colonnes) if (!vues.has(c.key)) vues.set(c.key, c);
        }
        setColonnes([...vues.values()]);
      } catch { setColonnes([]); }
      finally { setLoading(false); }
    }
  };

  /** Suffixe ?colonnes=… uniquement si une sélection partielle est active. */
  const suffixe = () => {
    if (!colonnes || exclues.size === 0) return q;
    const gardees = colonnes.filter((c) => !exclues.has(c.key)).map((c) => c.key);
    if (!gardees.length || gardees.length === colonnes.length) return q;
    const param = `colonnes=${encodeURIComponent(gardees.join(','))}`;
    return q ? `${q}&${param}` : `?${param}`;
  };

  const nbGardees = colonnes ? colonnes.length - exclues.size : 0;
  const selectionActive = colonnes != null && exclues.size > 0 && nbGardees > 0;

  return (
    <div className="relative inline-flex items-center gap-2">
      <button type="button" onClick={ouvrirPicker} className={cls} title="Choisir les colonnes à exporter">
        <SlidersHorizontal size={15} />
        Colonnes{selectionActive ? ` (${nbGardees}/${colonnes!.length})` : ''}
      </button>
      <button type="button" onClick={() => downloadFile(`${base}/xlsx${suffixe()}`, `${name}.xlsx`)} className={cls}>
        <Download size={15} /> Excel
      </button>
      <button type="button" onClick={() => downloadFile(`${base}/pdf${suffixe()}`, `${name}.pdf`)} className={cls}>
        <FileText size={15} /> PDF
      </button>

      {pickerOpen && (
        <div ref={panelRef} className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-gray-100 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600">Colonnes à exporter</p>
            <div className="flex items-center gap-2">
              <button type="button" className="text-[11px] font-medium text-[#2471A3] hover:underline"
                onClick={() => setExclues(new Set())}>Tout</button>
              <button type="button" onClick={() => setPickerOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
            </div>
          </div>
          {loading ? (
            <p className="py-4 text-center text-xs text-gray-400">Chargement…</p>
          ) : !colonnes?.length ? (
            <p className="py-4 text-center text-xs text-gray-400">Colonnes indisponibles pour cet export.</p>
          ) : (
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {colonnes.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
                  <input type="checkbox" checked={!exclues.has(c.key)}
                    onChange={(e) => setExclues((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.delete(c.key); else next.add(c.key);
                      return next;
                    })} />
                  {c.header}
                </label>
              ))}
            </div>
          )}
          {colonnes != null && nbGardees === 0 && (
            <p className="mt-2 text-[11px] text-red-600">Au moins une colonne doit rester cochée (sinon tout est exporté).</p>
          )}
        </div>
      )}
    </div>
  );
}
