'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, EmptyState } from '@/components/shared/states';
import { SeveriteBadge, StatutIncidentBadge } from '@/components/shared/Badge';
import { useSupervisionSocket } from '@/lib/hooks/useSupervisionSocket';
import { TYPES_INCIDENT } from '@/lib/constants';
import { fmtDateTime } from '@/lib/utils';

interface Incident {
  id: string;
  type: string;
  severite: string;
  statut: string;
  description: string;
  dateOuverture: string;
  site?: { code: string; nom: string; region: string };
  technicien?: { nom: string; prenom: string };
}

export default function SupervisionIncidentsPage() {
  const router = useRouter();
  useSupervisionSocket();

  const { data, isLoading } = useQuery({
    queryKey: ['incidents', { live: true }],
    queryFn: () => api.get('/incidents', { params: { limit: 100 } }).then((r) => r.data),
    refetchInterval: 30_000,
    // staleTime aligné : sans lui, chaque tick refait un aller-retour réseau
    // même si la donnée vient d'arriver (endpoints agrégés coûteux).
    staleTime: 30_000,
  });

  const actifs: Incident[] = (data?.data ?? []).filter((i: Incident) => i.statut === 'OUVERT' || i.statut === 'EN_COURS');

  return (
    <div>
      <PageHeader
        title="Supervision incidents"
        subtitle="Incidents actifs en temps réel"
        actions={
          <span className="flex items-center gap-1.5 text-xs text-green-600">
            <Radio size={14} className="animate-pulse" /> Live
          </span>
        }
      />

      {isLoading ? (
        <Loading />
      ) : actifs.length === 0 ? (
        <EmptyState title="✅ Aucun incident actif" hint="Tous les incidents sont résolus." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {actifs.map((inc) => (
            <button
              key={inc.id}
              onClick={() => router.push(`/incidents/${inc.id}`)}
              className="text-left bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-gray-800 text-sm">{inc.site?.nom}</span>
                <div className="flex gap-1">
                  <SeveriteBadge value={inc.severite} />
                  <StatutIncidentBadge value={inc.statut} />
                </div>
              </div>
              <p className="text-xs font-medium text-gray-600">{TYPES_INCIDENT.find((t) => t.value === inc.type)?.label ?? inc.type}</p>
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{inc.description}</p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                <span>{inc.site?.region}</span>
                <span>{fmtDateTime(inc.dateOuverture)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
