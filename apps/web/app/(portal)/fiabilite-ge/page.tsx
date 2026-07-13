'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Gauge, Wrench, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { fmtNumber } from '@/lib/utils';

interface Marque { marque: string; nbGE: number; nbCuratives: number; tauxPanne: number; heuresTotales: number; mtbfHeures: number | null }
interface Report {
  jours: number; parMarque: Marque[]; curativesNonImputables: number; gesSansMarque: number; couvertureMarquePct: number;
}

export default function FiabiliteGePage() {
  const [jours, setJours] = useState('180');
  const { data, isLoading, isError } = useQuery<Report>({
    queryKey: ['fiabilite-ge', jours],
    queryFn: () => api.get('/rapports/fiabilite-ge', { params: { jours } }).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState message="Analyse indisponible" />;

  // On n'affiche dans le graphique que les marques renseignées avec des GE.
  const marquesReelles = data.parMarque.filter((m) => m.marque !== '(sans marque)' && m.nbGE > 0);

  return (
    <div>
      <PageHeader title="Fiabilité des GE par marque" subtitle="Taux de panne et MTBF par constructeur, pour éclairer les achats" />

      <FilterBar
        filters={[
          { key: 'jours', label: 'Période', value: jours, options: [
            { value: '90', label: '3 mois' }, { value: '180', label: '6 mois' },
            { value: '365', label: '12 mois' }, { value: '730', label: '24 mois' },
          ], onChange: setJours },
        ]}
      />

      {/* Transparence : la fiabilité de l'analyse dépend du remplissage des données. */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm">
        <Info size={16} className="text-blue-600" />
        <span><b>{data.couvertureMarquePct}%</b> des GE ont une marque renseignée</span>
        {data.gesSansMarque > 0 && <span className="text-gray-600">· {data.gesSansMarque} GE sans marque</span>}
        {data.curativesNonImputables > 0 && (
          <span className="text-gray-600">· {data.curativesNonImputables} panne(s) non rattachable(s) à une marque</span>
        )}
        <span className="text-xs text-gray-400">Renseignez les marques (fiche GE / import) et rattachez les curatives au GE pour affiner.</span>
      </div>

      {marquesReelles.length === 0 ? (
        <EmptyState title="Pas encore de données exploitables" hint="Renseignez les marques des GE et enregistrez des dépannages curatifs rattachés à un GE." />
      ) : (
        <>
          <div className="mb-6 rounded-xl border border-gray-100 bg-white p-5">
            <h3 className="mb-4 text-sm font-semibold text-gray-700">Taux de panne par marque (curatives / GE)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={marquesReelles}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="marque" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number, n: string) => [n === 'tauxPanne' ? `${v} panne(s)/GE` : v, n]} />
                <Bar dataKey="tauxPanne" name="Pannes / GE" fill="#DC2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-3 pl-5 pr-4 font-medium">Marque</th>
                <th className="px-3 py-3 text-right font-medium">Parc (GE)</th>
                <th className="px-3 py-3 text-right font-medium">Pannes</th>
                <th className="px-3 py-3 text-right font-medium">Taux de panne</th>
                <th className="px-3 py-3 text-right font-medium">Heures cumulées</th>
                <th className="px-3 py-3 pr-5 text-right font-medium">MTBF (h entre pannes)</th>
              </tr></thead>
              <tbody>
                {marquesReelles.map((m) => (
                  <tr key={m.marque} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 pl-5 pr-4 font-medium text-gray-800 flex items-center gap-2"><Gauge size={15} className="text-gray-400" />{m.marque}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{m.nbGE}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{m.nbCuratives}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className={m.tauxPanne >= 1 ? 'font-semibold text-red-600' : m.tauxPanne >= 0.5 ? 'text-amber-600' : 'text-gray-700'}>
                        {m.tauxPanne} /GE
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600">{fmtNumber(m.heuresTotales)} h</td>
                    <td className="px-3 py-3 pr-5 text-right tabular-nums">
                      {m.mtbfHeures != null ? <span className="font-medium text-gray-800">{fmtNumber(m.mtbfHeures)} h</span> : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
            <Wrench size={13} /> MTBF = heures de marche cumulées ÷ nombre de pannes. Un MTBF élevé et un taux de panne bas = marque fiable.
          </p>
        </>
      )}
    </div>
  );
}
