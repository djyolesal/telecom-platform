'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, CheckCircle2, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { StatutMaintBadge } from '@/components/shared/Badge';
import { Field, Textarea } from '@/components/shared/Form';
import { TYPES_MAINTENANCE, CATEGORIES_EQUIPEMENT } from '@/lib/constants';
import { fmtDateTime } from '@/lib/utils';

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
  const queryClient = useQueryClient();
  const [observations, setObservations] = useState('');

  const { data: m, isLoading, isError } = useQuery({
    queryKey: ['maintenance', id],
    queryFn: () => api.get(`/maintenances/${id}`).then((r) => r.data.data),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['maintenance', id] });

  const start = useMutation({ mutationFn: () => api.post(`/maintenances/${id}/start`), onSuccess: refresh });
  const close = useMutation({ mutationFn: () => api.post(`/maintenances/${id}/close`, { observations }), onSuccess: refresh });

  if (isLoading) return <Loading />;
  if (isError || !m) return <ErrorState message="Maintenance introuvable" />;

  return (
    <div>
      <PageHeader
        title={`Maintenance — ${m.site?.code ?? ''}`}
        subtitle={m.equipement}
        backHref="/maintenance"
        actions={
          <>
            {m.statut === 'PLANIFIEE' && <Button icon={Play} loading={start.isPending} onClick={() => start.mutate()}>Démarrer</Button>}
            {m.statut === 'EN_COURS' && <Button icon={CheckCircle2} loading={close.isPending} onClick={() => close.mutate()}>Clôturer</Button>}
            <a href={`${process.env.NEXT_PUBLIC_API_URL}/maintenances/${id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <FileText size={15} /> PDF
            </a>
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
          <Row label="Catégorie" value={CATEGORIES_EQUIPEMENT.find((c) => c.value === m.categorie)?.label ?? m.categorie} />
          <Row label="Équipement" value={m.equipement} />
          <Row label="Technicien" value={m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : '—'} />
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

          {m.statut === 'EN_COURS' && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Clôture</h3>
              <Field label="Observations">
                <Textarea value={observations} onChange={(e) => setObservations(e.target.value)} placeholder="Travaux réalisés, constats…" />
              </Field>
              <div className="mt-3 flex justify-end">
                <Button icon={CheckCircle2} loading={close.isPending} onClick={() => close.mutate()}>Clôturer la maintenance</Button>
              </div>
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
