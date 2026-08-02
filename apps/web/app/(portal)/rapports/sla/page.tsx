'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, Banknote, Timer } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { fmtFCFA } from '@/lib/utils';

interface Sla {
  prestataireId: string; prestataireNom: string;
  preventivesPlanifiees: number; preventivesATemps: number; tauxPreventif: number;
  incidentsResolus: number; incidentsHorsDelai: number; delaiResolutionMoyenH: number | null;
  nbSites: number; downtimePassifHeures: number; dispoPassivePct: number;
  scoreSla: number; penaliteFCFA: number; conforme: boolean;
}
interface Report {
  periodeJours: number;
  seuils: { delaiResolutionMaxH: number; tauxPreventifMinPct: number; dispoPassiveMinPct: number };
  parPrestataire: Sla[];
  penaliteTotaleFCFA: number;
}

const scoreColor = (s: number) => s >= 90 ? 'text-green-600' : s >= 70 ? 'text-amber-600' : 'text-red-600';

export default function SlaPage() {
  const [jours, setJours] = useState('90');
  const { data, isLoading, isError } = useQuery<Report>({
    queryKey: ['sla-prestataires', jours],
    queryFn: () => api.get('/rapports/sla-prestataires', { params: { jours } }).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState message="Rapport SLA indisponible" />;

  const nonConformes = data.parPrestataire.filter((p) => !p.conforme).length;

  return (
    <div>
      <PageHeader title="SLA prestataires" subtitle="Respect des engagements contractuels et pénalités estimées" backHref="/rapports" />

      <FilterBar
        filters={[
          { key: 'jours', label: 'Période', value: jours, options: [
            { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' },
            { value: '180', label: '6 mois' }, { value: '365', label: '12 mois' },
          ], onChange: setJours },
        ]}
      />

      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Prestataires suivis" value={String(data.parPrestataire.length)} icon={ShieldCheck} color="bg-[#1B3F6B]" />
        <StatCard title="Hors SLA" value={String(nonConformes)} icon={AlertTriangle} color="bg-[#DC2626]" />
        <StatCard title="Pénalités estimées" value={fmtFCFA(data.penaliteTotaleFCFA)} icon={Banknote} color="bg-[#F59E0B]" />
        <StatCard title="Seuils" value={`${data.seuils.tauxPreventifMinPct}% · ${data.seuils.delaiResolutionMaxH}h · ${data.seuils.dispoPassiveMinPct}%`} subtitle="préventif min · résolution max · dispo passive min" icon={Timer} color="bg-[#2471A3]" />
      </div>

      {data.parPrestataire.length === 0 ? (
        <EmptyState title="Aucune donnée SLA" hint="Aucun prestataire rattaché à des sites/incidents sur la période." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="py-3 pl-5 pr-4 font-medium">Prestataire</th>
              <th className="px-3 py-3 text-center font-medium">Statut</th>
              <th className="px-3 py-3 text-right font-medium">Préventif à temps</th>
              <th className="px-3 py-3 text-right font-medium">Incidents (hors délai)</th>
              <th className="px-3 py-3 text-right font-medium">Résolution moy.</th>
              <th className="px-3 py-3 text-right font-medium">Dispo passive</th>
              <th className="px-3 py-3 text-right font-medium">Score SLA</th>
              <th className="px-3 py-3 pr-5 text-right font-medium">Pénalité</th>
            </tr></thead>
            <tbody>
              {data.parPrestataire.map((p) => (
                <tr key={p.prestataireId} className="border-b border-gray-50 last:border-0">
                  <td className="py-3 pl-5 pr-4 font-medium text-gray-800">{p.prestataireNom}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.conforme ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {p.conforme ? 'Conforme' : 'Hors SLA'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span className={p.tauxPreventif >= data.seuils.tauxPreventifMinPct ? 'text-gray-700' : 'font-semibold text-red-600'}>{p.tauxPreventif}%</span>
                    <span className="ml-1 text-xs text-gray-400">({p.preventivesATemps}/{p.preventivesPlanifiees})</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {p.incidentsResolus}
                    {p.incidentsHorsDelai > 0 && <span className="ml-1 font-semibold text-red-600">({p.incidentsHorsDelai} ⚠)</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-600">{p.delaiResolutionMoyenH != null ? `${p.delaiResolutionMoyenH} h` : '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span className={(p.dispoPassivePct ?? 100) >= data.seuils.dispoPassiveMinPct ? 'text-gray-700' : 'font-semibold text-red-600'}>{p.dispoPassivePct ?? 100}%</span>
                    <span className="ml-1 text-xs text-gray-400">({p.downtimePassifHeures ?? 0} h / {p.nbSites ?? 0} sites)</span>
                  </td>
                  <td className={`px-3 py-3 text-right tabular-nums font-semibold ${scoreColor(p.scoreSla)}`}>{p.scoreSla}</td>
                  <td className="px-3 py-3 pr-5 text-right tabular-nums">{p.penaliteFCFA > 0 ? <span className="font-semibold text-amber-700">{fmtFCFA(p.penaliteFCFA)}</span> : <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-400">
        Pénalité = (incidents résolus hors délai × pénalité unitaire) + (points de préventif sous le seuil × pénalité/point). Seuils configurables dans Administration → Paramètres (groupe SLA).
      </p>
    </div>
  );
}
