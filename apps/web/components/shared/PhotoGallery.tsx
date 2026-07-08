'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn } from 'lucide-react';

/**
 * Galerie de photos terrain : vignettes cliquables + visionneuse plein écran
 * coulissante (flèches, clavier ← → / Échap, compteur).
 */
export function PhotoGallery({ photos, title = 'Photos' }: { photos: { id: string; url: string }[]; title?: string }) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowRight') setLightbox((i) => (i === null ? i : (i + 1) % photos.length));
      else if (e.key === 'ArrowLeft') setLightbox((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, photos.length]);

  if (!photos.length) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h3 className="font-semibold text-gray-700 text-sm mb-2">{title} ({photos.length})</h3>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <button key={p.id} type="button" onClick={() => setLightbox(i)} className="group relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded object-cover border border-gray-100 transition group-hover:opacity-90" />
            <span className="absolute inset-0 flex items-center justify-center rounded bg-black/0 transition group-hover:bg-black/20">
              <ZoomIn size={18} className="text-white opacity-0 transition group-hover:opacity-100" />
            </span>
          </button>
        ))}
      </div>

      {/* ── Visionneuse plein écran ── */}
      {lightbox !== null && photos[lightbox] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightbox(null)}
        >
          <button type="button" className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => setLightbox(null)}>
            <X size={28} />
          </button>
          <span className="absolute top-5 left-5 text-sm text-white/70">{lightbox + 1} / {photos.length}</span>

          {photos.length > 1 && (
            <button
              type="button"
              className="absolute left-3 sm:left-6 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i === null ? i : (i - 1 + photos.length) % photos.length)); }}
            >
              <ChevronLeft size={28} />
            </button>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[lightbox].url}
            alt={`Photo ${lightbox + 1}`}
            className="max-h-[90vh] max-w-[92vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {photos.length > 1 && (
            <button
              type="button"
              className="absolute right-3 sm:right-6 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i === null ? i : (i + 1) % photos.length)); }}
            >
              <ChevronRight size={28} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
