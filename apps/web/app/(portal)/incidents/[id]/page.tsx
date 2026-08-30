'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, CheckCircle2, AlertCircle, Wrench, Clock, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { SeveriteBadge, StatutIncidentBadge } from '@/components/shared/Badge';
import { SearchSelect } from '@/components/shared/SearchSelect';
import { PhotoGallery } from '@/components/shared/PhotoGallery';
import { SignatureBlock } from '@/components/shared/SignatureBlock';
import { useTypesIncident } from '@/lib/typesIncident';
import { fmtDateTime } from '@/lib/utils';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800 text-right">{value ?? '—'}</span>
    </div>
  );
}

function TimelineItem({ icon: Icon, label, date, done }: { icon: React.ElementType; label: string; date?: string | null; done: boolean }) {
  return (
    <div className="flex gap-3">
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${done ? 'bg-[#0E7C6B] text-white' : 'bg-gray-100 text-gray-400'}`}>
        <Icon size={15} />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-xs text-gray-400">{date ? fmtDateTime(date) : 'En attente'}</p>
      </div>
    </div>
  );
}

export default function IncidentDetailPage() {
  const { labelDe } = useTypesIncident();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [technicienId, setTechnicienId] = useState('');

  const { data: inc, isLoading, isError } = useQuery({
    queryKey: ['incident', id],
    queryFn: () => api.get(`/incidents/${id}`).then((r) => r.data.data),
  });
  // Seuls les techniciens que le serveur ACCEPTERAIT : internes + prestataires
  // du lot du site (société et scope affichés pour guider le choix).
  const { data: techs } = useQuery({
    queryKey: ['techs-assignables', id],
    queryFn: () => api.get(`/incidents/${id}/techniciens-assignables`).then((r) => r.data.data),
    enabled: !!inc && inc.statut === 'OUVERT',
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['incident', id] });
  const assign = useMutation({ mutationFn: () => api.post(`/incidents/${id}/assign`, { technicienId }), onSuccess: refresh });

  if (isLoading) return <Loading />;
  if (isError || !inc) return <ErrorState message="Incident introuvable" />;

  const techOptions = (techs ?? []).map((t: { id: string; nom: string; prenom: string; societe: string; scopes: string[] }) => ({
    value: t.id,
    label: `${t.prenom} ${t.nom} - ${t.societe}${t.scopes.length ? ` (${t.scopes.join('/')})` : ''}`,
  }));
  const resolu = inc.statut === 'RESOLU' || inc.statut === 'CLOS';

  return (
    <div>
      <PageHeader
        title={`${inc.reference ?? "Incident"} - ${inc.site?.nom ?? ""}`}
        subtitle={labelDe(inc.type)}
        backHref="/incidents"
        actions={<div className="flex gap-2"><SeveriteBadge value={inc.severite} /><StatutIncidentBadge value={inc.statut} /></div>}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-700 text-sm mb-3">Détails</h3>
            <Row label="Site" value={inc.site?.nom ?? '—'} />
            <Row label="Région" value={inc.site?.region} />
            <Row label="Technicien" value={inc.technicien ? `${inc.technicien.prenom} ${inc.technicien.nom}` : '—'} />
            <Row label="Délai intervention" value={inc.delaiInterventionMinutes != null ? `${inc.delaiInterventionMinutes} min` : '—'} />
            <Row label="Durée coupure" value={inc.dureeCoupureMinutes != null ? `${inc.dureeCoupureMinutes} min` : '—'} />
            <div className="mt-3">
              <p className="text-sm text-gray-500 mb-1">Description</p>
              <p className="text-sm text-gray-700">{inc.description}</p>
            </div>
            {inc.causeProbable && <div className="mt-3"><p className="text-sm text-gray-500 mb-1">Cause probable</p><p className="text-sm text-gray-700">{inc.causeProbable}</p></div>}
            {inc.actionCorrective && <div className="mt-3"><p className="text-sm text-gray-500 mb-1">Action corrective</p><p className="text-sm text-gray-700">{inc.actionCorrective}</p></div>}
          </div>

          {inc.statut === 'OUVERT' && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-700 text-sm mb-3">Assigner un technicien</h3>
              <div className="flex gap-2">
                <div className="flex-1"><SearchSelect value={technicienId} onChange={setTechnicienId} options={techOptions} placeholder="Rechercher un technicien…" /></div>
                <Button icon={UserPlus} disabled={!technicienId} loading={assign.isPending} onClick={() => assign.mutate()}>Assigner</Button>
              </div>
            </div>
          )}

          <PhotoGallery photos={inc.photos ?? []} />

          <SignatureBlock signatures={inc.signatures} />

          {!resolu && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 flex items-start gap-3">
              <Smartphone size={18} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-500">
                Démarrage et clôture retirés du web : l&apos;intervention s&apos;exécute sur site via l&apos;application
                mobile (vérification GPS et au moins 6 photos prises sur place avant clôture).
              </p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 h-fit">
          <h3 className="font-semibold text-gray-700 text-sm mb-4">Chronologie</h3>
          <div className="space-y-4">
            <TimelineItem icon={AlertCircle} label="Ouverture" date={inc.dateOuverture} done />
            <TimelineItem icon={Wrench} label="Intervention" date={inc.dateIntervention} done={!!inc.dateIntervention} />
            <TimelineItem icon={CheckCircle2} label="Résolution" date={inc.dateResolution} done={!!inc.dateResolution} />
            <TimelineItem icon={Clock} label="Clôture" date={resolu ? inc.dateResolution : null} done={inc.statut === 'CLOS'} />
          </div>
        </div>
      </div>
    </div>
  );
}
