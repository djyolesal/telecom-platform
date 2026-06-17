'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, CheckCircle2, FileText, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { StatutMaintBadge } from '@/components/shared/Badge';
import { Field, Input, Textarea } from '@/components/shared/Form';
import { TYPES_MAINTENANCE, CATEGORIES_EQUIPEMENT, PASSIVE_CATEGORIES, energySourcesForConfig } from '@/lib/constants';
import { fmtDateTime, fmtNumber } from '@/lib/utils';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800 text-right">{value ?? '—'}</span>
    </div>
  );
}

type Energie = { volumeGasoilLitres?: string; heuresFonctGE?: string; indexCompteur?: string; consommationKwh?: string; puissanceKva?: string };

export default function MaintenanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [observations, setObservations] = useState('');
  const [energie, setEnergie] = useState<Energie>({});
  const setE = (k: keyof Energie, v: string) => setEnergie((p) => ({ ...p, [k]: v }));

  const { data: m, isLoading, isError } = useQuery({
    queryKey: ['maintenance', id],
    queryFn: () => api.get(`/maintenances/${id}`).then((r) => r.data.data),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['maintenance', id] });
  const start = useMutation({ mutationFn: () => api.post(`/maintenances/${id}/start`), onSuccess: refresh });
  const close = useMutation({
    mutationFn: () => api.post(`/maintenances/${id}/close`, { observations, energie }),
    onSuccess: refresh,
  });

  if (isLoading) return <Loading />;
  if (isError || !m) return <ErrorState message="Maintenance introuvable" />;

  const isPassive = PASSIVE_CATEGORIES.includes(m.categorie);
  const sources = isPassive ? energySourcesForConfig(m.site?.powerConfig) : [];
  const hasGe = sources.includes('GE');
  const hasCeet = sources.includes('CEET');
  const hasSolaire = sources.includes('SOLAIRE');

  // Champs requis présents ?
  const energyComplete =
    (!hasGe || (!!energie.volumeGasoilLitres && !!energie.heuresFonctGE)) &&
    (!hasCeet || !!energie.indexCompteur) &&
    (!hasSolaire || !!energie.puissanceKva);

  return (
    <div>
      <PageHeader
        title={`Maintenance — ${m.site?.code ?? ''}`}
        subtitle={m.equipement}
        backHref="/maintenance"
        actions={
          <>
            {m.statut === 'PLANIFIEE' && <Button icon={Play} loading={start.isPending} onClick={() => start.mutate()}>Démarrer</Button>}
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

          {/* ── Clôture ── */}
          {m.statut === 'EN_COURS' && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-700 text-sm mb-3">Clôture</h3>

              {isPassive && sources.length > 0 && (
                <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-blue-800 mb-2">
                    <Zap size={13} /> Relevés énergie obligatoires (config {m.site?.powerConfig})
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {hasGe && (
                      <>
                        <Field label="Volume gasoil (L) *"><Input type="number" step="0.01" value={energie.volumeGasoilLitres ?? ''} onChange={(e) => setE('volumeGasoilLitres', e.target.value)} /></Field>
                        <Field label="Heures fonct. GE *"><Input type="number" step="0.1" value={energie.heuresFonctGE ?? ''} onChange={(e) => setE('heuresFonctGE', e.target.value)} /></Field>
                      </>
                    )}
                    {hasCeet && (
                      <>
                        <Field label="Index compteur CEET *"><Input type="number" step="0.01" value={energie.indexCompteur ?? ''} onChange={(e) => setE('indexCompteur', e.target.value)} /></Field>
                        <Field label="Consommation (kWh)"><Input type="number" step="0.01" value={energie.consommationKwh ?? ''} onChange={(e) => setE('consommationKwh', e.target.value)} /></Field>
                      </>
                    )}
                    {hasSolaire && (
                      <Field label="Puissance solaire (kVA) *"><Input type="number" step="0.01" value={energie.puissanceKva ?? ''} onChange={(e) => setE('puissanceKva', e.target.value)} /></Field>
                    )}
                  </div>
                </div>
              )}

              <Field label="Observations">
                <Textarea value={observations} onChange={(e) => setObservations(e.target.value)} placeholder="Travaux réalisés, constats…" />
              </Field>
              {close.isError && <p className="mt-2 text-xs text-red-500">Erreur : vérifiez les paramètres énergie requis.</p>}
              <div className="mt-3 flex justify-end">
                <Button icon={CheckCircle2} loading={close.isPending} disabled={isPassive && !energyComplete} onClick={() => close.mutate()}>
                  Clôturer la maintenance
                </Button>
              </div>
            </div>
          )}

          {/* ── Relevés énergie capturés ── */}
          {m.releves?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Relevés énergie</h3>
              <ul className="space-y-1 text-sm text-gray-600">
                {m.releves.map((r: { id: string; source: string; volumeGasoilLitres?: number; heuresFonctGE?: number; indexCompteur?: number; consommationKwh?: number; puissanceKva?: number }) => (
                  <li key={r.id} className="flex justify-between">
                    <span className="font-medium text-gray-700">{r.source}</span>
                    <span className="text-gray-500">
                      {r.source === 'GE' && `${fmtNumber(r.volumeGasoilLitres)} L · ${fmtNumber(r.heuresFonctGE)} h`}
                      {r.source === 'CEET' && `index ${fmtNumber(r.indexCompteur)}${r.consommationKwh != null ? ` · ${fmtNumber(r.consommationKwh)} kWh` : ''}`}
                      {r.source === 'SOLAIRE' && `${fmtNumber(r.puissanceKva)} kVA`}
                    </span>
                  </li>
                ))}
              </ul>
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
    </div>
  );
}
