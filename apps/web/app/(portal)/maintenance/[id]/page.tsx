'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileText, X, ZoomIn, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState } from '@/components/shared/states';
import { StatutMaintBadge } from '@/components/shared/Badge';
import { TYPES_MAINTENANCE, CATEGORIES_EQUIPEMENT, PASSIVE_CATEGORIES } from '@/lib/constants';
import { fmtDateTime, fmtNumber } from '@/lib/utils';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800 text-right">{value ?? '—'}</span>
    </div>
  );
}

export default function MaintenanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [lightbox, setLightbox] = useState<number | null>(null);

  const { data: m, isLoading, isError } = useQuery({
    queryKey: ['maintenance', id],
    queryFn: () => api.get(`/maintenances/${id}`).then((r) => r.data.data),
  });

  const photoList: { id: string; url: string }[] = m?.photos ?? [];

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowRight') setLightbox((i) => (i === null ? i : (i + 1) % photoList.length));
      else if (e.key === 'ArrowLeft') setLightbox((i) => (i === null ? i : (i - 1 + photoList.length) % photoList.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, photoList.length]);

  if (isLoading) return <Loading />;
  if (isError || !m) return <ErrorState message="Maintenance introuvable" />;

  const isPassive = PASSIVE_CATEGORIES.includes(m.categorie);

  return (
    <div>
      <PageHeader
        title={`Maintenance — ${m.site?.nom ?? m.site?.code ?? ''}`}
        subtitle={m.equipement}
        backHref="/maintenance"
        actions={
          <>
            {/* Démarrage et clôture retirés du web : l'exécution se fait sur site (mobile, GPS + photos). */}
            <button type="button" onClick={() => downloadFile(`/maintenances/${id}/pdf`, `maintenance-${id}.pdf`, true)} className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <FileText size={15} /> PDF
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-700 text-sm">Détails</h3>
            <StatutMaintBadge value={m.statut} />
          </div>
          <Row label="Site" value={m.site ? `${m.site.code} — ${m.site.nom}` : '—'} />
          <Row label="Type" value={TYPES_MAINTENANCE.find((t) => t.value === m.type)?.label ?? m.type} />
          <Row label="Catégorie" value={`${CATEGORIES_EQUIPEMENT.find((c) => c.value === m.categorie)?.label ?? m.categorie}${isPassive ? ' · passive' : ' · active'}`} />
          <Row label="Équipement" value={m.equipement} />
          <Row label="Technicien" value={m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : '—'} />
          <Row label="Prestataire" value={m.prestataire?.nom} />
          <Row label="Planifiée" value={fmtDateTime(m.datePlanifiee)} />
          <Row label="Début" value={fmtDateTime(m.dateDebut)} />
          <Row label="Fin" value={fmtDateTime(m.dateFin)} />
          <Row label="Durée" value={m.dureeMinutes != null ? `${m.dureeMinutes} min` : '—'} />
        </div>

        <div className="space-y-6">
          {m.description && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Description</h3>
              <p className="text-sm text-gray-600">{m.description}</p>
            </div>
          )}

          {/* ── Analyse de cohérence énergie (générée à la clôture) ── */}
          {m.analyseEnergie && (
            <div className={`rounded-xl border p-5 ${m.analyseEnergie.startsWith('⚠') ? 'border-orange-200 bg-orange-50/60' : 'border-green-100 bg-green-50/50'}`}>
              <h3 className={`font-semibold text-sm mb-1 ${m.analyseEnergie.startsWith('⚠') ? 'text-orange-900' : 'text-green-800'}`}>Analyse de cohérence énergie</h3>
              <p className="text-sm text-gray-700">{m.analyseEnergie}</p>
            </div>
          )}

          {/* ── Relevés énergie capturés ── */}
          {m.releves?.length > 0 && (() => {
            type R = { id: string; source: string; volumeGasoilLitres?: number; gasoilConsommeLitres?: number; heuresFonctGE?: number; indexCompteur?: number; consommationKwh?: number; puissanceKva?: number; groupe?: { numero: number } };
            const releves: R[] = m.releves;
            const ge = releves.filter((r) => r.source === 'GE').sort((a, b) => (a.groupe?.numero ?? 0) - (b.groupe?.numero ?? 0));
            const autres = releves.filter((r) => r.source !== 'GE');
            const gasoilRow = ge.find((r) => r.gasoilConsommeLitres != null) ?? ge.find((r) => r.volumeGasoilLitres != null);
            const totalHeures = ge.reduce((s, r) => s + Number(r.heuresFonctGE ?? 0), 0);
            const hasHeures = ge.some((r) => r.heuresFonctGE != null);
            return (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-700 text-sm mb-2">Relevés énergie</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  {gasoilRow && (
                    <li className="flex justify-between gap-4">
                      <span className="font-medium text-gray-700">Gasoil consommé</span>
                      <span className="text-gray-500 text-right">
                        {gasoilRow.gasoilConsommeLitres != null ? `${fmtNumber(gasoilRow.gasoilConsommeLitres)} L` : '—'}
                        {gasoilRow.volumeGasoilLitres != null ? ` · cuve ${fmtNumber(gasoilRow.volumeGasoilLitres)} L` : ''}
                      </span>
                    </li>
                  )}
                  {ge.map((r) => (
                    <li key={r.id} className="flex justify-between gap-4">
                      <span className="font-medium text-gray-700">Heures de fonctionnement GE{r.groupe?.numero ?? ''}</span>
                      <span className="text-gray-500 text-right">{r.heuresFonctGE != null ? `${fmtNumber(r.heuresFonctGE)} h` : '—'}</span>
                    </li>
                  ))}
                  {ge.length > 1 && hasHeures && (
                    <li className="flex justify-between gap-4 border-t border-gray-50 pt-1">
                      <span className="font-semibold text-gray-700">Total heures GE</span>
                      <span className="font-semibold text-gray-700 text-right">{fmtNumber(totalHeures)} h</span>
                    </li>
                  )}
                  {autres.map((r) => (
                    <li key={r.id} className="flex justify-between gap-4">
                      <span className="font-medium text-gray-700">{r.source}</span>
                      <span className="text-gray-500 text-right">
                        {r.source === 'CEET' && (
                          <>
                            {r.consommationKwh != null ? `${fmtNumber(r.consommationKwh)} kWh` : '— kWh'}
                            {` · index ${fmtNumber(r.indexCompteur)}`}
                          </>
                        )}
                        {r.source === 'SOLAIRE' && `${fmtNumber(r.puissanceKva)} kVA`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {m.photos?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Photos ({m.photos.length})</h3>
              <div className="flex flex-wrap gap-2">
                {m.photos.map((p: { id: string; url: string }, i: number) => (
                  <button key={p.id} type="button" onClick={() => setLightbox(i)} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded object-cover border border-gray-100 transition group-hover:opacity-90" />
                    <span className="absolute inset-0 flex items-center justify-center rounded bg-black/0 transition group-hover:bg-black/20">
                      <ZoomIn size={18} className="text-white opacity-0 transition group-hover:opacity-100" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {m.pieces?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Pièces de rechange</h3>
              <ul className="space-y-1 text-sm text-gray-600">
                {m.pieces.map((p: { id: string; nom: string; quantite: number; reference?: string }) => (
                  <li key={p.id} className="flex justify-between">
                    <span>{p.quantite}× {p.nom}</span>
                    <span className="text-gray-400">{p.reference ?? ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {m.observations && m.statut === 'TERMINEE' && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Observations</h3>
              <p className="text-sm text-gray-600">{m.observations}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Visionneuse plein écran ── */}
      {lightbox !== null && photoList[lightbox] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightbox(null)}
        >
          <button type="button" className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => setLightbox(null)}>
            <X size={28} />
          </button>
          <span className="absolute top-5 left-5 text-sm text-white/70">{lightbox + 1} / {photoList.length}</span>

          {photoList.length > 1 && (
            <button
              type="button"
              className="absolute left-3 sm:left-6 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i === null ? i : (i - 1 + photoList.length) % photoList.length)); }}
            >
              <ChevronLeft size={28} />
            </button>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoList[lightbox].url}
            alt={`Photo ${lightbox + 1}`}
            className="max-h-[90vh] max-w-[92vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {photoList.length > 1 && (
            <button
              type="button"
              className="absolute right-3 sm:right-6 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i === null ? i : (i + 1) % photoList.length)); }}
            >
              <ChevronRight size={28} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
