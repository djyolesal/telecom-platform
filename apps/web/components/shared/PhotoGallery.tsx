'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, RotateCw, Download, Maximize2 } from 'lucide-react';

/**
 * Galerie de photos terrain : vignettes cliquables + visionneuse plein écran.
 * Visionneuse : navigation (flèches, clavier ← → / Échap), zoom (molette,
 * boutons, double-clic), déplacement (glisser quand zoomé), rotation et
 * téléchargement de la photo courante.
 */
export function PhotoGallery({ photos, title = 'Photos' }: { photos: { id: string; url: string }[]; title?: string }) {
  const [index, setIndex] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [rot, setRot] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => { setScale(1); setRot(0); setOffset({ x: 0, y: 0 }); }, []);
  const go = useCallback((d: number) => {
    setIndex((i) => (i === null ? i : (i + d + photos.length) % photos.length));
    reset();
  }, [photos.length, reset]);
  const close = useCallback(() => { setIndex(null); reset(); }, [reset]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') setScale((s) => Math.min(6, s + 0.5));
      else if (e.key === '-') setScale((s) => Math.max(1, s - 0.5));
      else if (e.key.toLowerCase() === 'r') setRot((r) => (r + 90) % 360);
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, go, close, reset]);

  // Réinitialise le pan si on dézoome complètement.
  useEffect(() => { if (scale === 1) setOffset({ x: 0, y: 0 }); }, [scale]);

  if (!photos.length) return null;
  const current = index !== null ? photos[index] : null;

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.min(6, Math.max(1, +(s - e.deltaY * 0.002).toFixed(2))));
  };
  const onDown = (e: React.MouseEvent) => {
    if (scale === 1) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    setOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
  };
  const onUp = () => { drag.current = null; setDragging(false); };

  const download = async () => {
    if (!current) return;
    try {
      const res = await fetch(current.url);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `photo-${(index ?? 0) + 1}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
    } catch {
      // Repli : ouvrir dans un nouvel onglet si le fetch échoue (CORS, etc.).
      window.open(current.url, '_blank', 'noopener');
    }
  };

  const CtrlBtn = ({ onClick, title: t, children }: { onClick: (e: React.MouseEvent) => void; title: string; children: React.ReactNode }) => (
    <button type="button" title={t}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/25">
      {children}
    </button>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h3 className="font-semibold text-gray-700 text-sm mb-2">{title} ({photos.length})</h3>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <button key={p.id} type="button" onClick={() => { setIndex(i); reset(); }} className="group relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded object-cover border border-gray-100 transition group-hover:opacity-90" />
            <span className="absolute inset-0 flex items-center justify-center rounded bg-black/0 transition group-hover:bg-black/20">
              <ZoomIn size={18} className="text-white opacity-0 transition group-hover:opacity-100" />
            </span>
          </button>
        ))}
      </div>

      {/* ── Visionneuse plein écran ── */}
      {current && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={close}>
          {/* Barre d'outils */}
          <div className="flex items-center justify-between px-4 py-3" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm text-white/70 tabular-nums">{(index ?? 0) + 1} / {photos.length}</span>
            <div className="flex items-center gap-1.5">
              <CtrlBtn onClick={() => setScale((s) => Math.max(1, s - 0.5))} title="Dézoomer (−)"><ZoomOut size={18} /></CtrlBtn>
              <span className="w-12 text-center text-xs text-white/70 tabular-nums">{Math.round(scale * 100)}%</span>
              <CtrlBtn onClick={() => setScale((s) => Math.min(6, s + 0.5))} title="Zoomer (+)"><ZoomIn size={18} /></CtrlBtn>
              <CtrlBtn onClick={reset} title="Réinitialiser (0)"><Maximize2 size={17} /></CtrlBtn>
              <CtrlBtn onClick={() => setRot((r) => (r + 90) % 360)} title="Pivoter (R)"><RotateCw size={17} /></CtrlBtn>
              <CtrlBtn onClick={download} title="Télécharger"><Download size={17} /></CtrlBtn>
              <CtrlBtn onClick={close} title="Fermer (Échap)"><X size={20} /></CtrlBtn>
            </div>
          </div>

          {/* Zone image */}
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden"
            onWheel={onWheel}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
          >
            {photos.length > 1 && (
              <button type="button" title="Précédente (←)"
                className="absolute left-3 sm:left-6 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/25"
                onClick={(e) => { e.stopPropagation(); go(-1); }}>
                <ChevronLeft size={28} />
              </button>
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={`Photo ${(index ?? 0) + 1}`}
              draggable={false}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => { e.stopPropagation(); setScale((s) => (s > 1 ? 1 : 2)); }}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rot}deg)`,
                cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
                transition: dragging ? 'none' : 'transform 0.12s ease-out',
              }}
              className="max-h-[82vh] max-w-[92vw] select-none object-contain"
            />

            {photos.length > 1 && (
              <button type="button" title="Suivante (→)"
                className="absolute right-3 sm:right-6 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/25"
                onClick={(e) => { e.stopPropagation(); go(1); }}>
                <ChevronRight size={28} />
              </button>
            )}
          </div>

          <p className="pb-3 text-center text-[11px] text-white/40" onClick={(e) => e.stopPropagation()}>
            Molette ou +/− pour zoomer · glisser pour déplacer · double-clic pour agrandir · R pour pivoter
          </p>
        </div>
      )}
    </div>
  );
}
