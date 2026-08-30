'use client';

import { useState } from 'react';
import { useTypesIncident } from '@/lib/typesIncident';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Timer, Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { Loading } from '@/components/shared/states';
import { regionOptions } from '@/lib/constants';

const COLORS = ['#C0392B', '#E67E22', '#F1C40F', '#3498DB', '#0E7C6B'];

function mins(m: number) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}`;
}

export default function IncidentKpisPage() {
  const { labelDe } = useTypesIncident();
  const [periode, setPeriode] = useState('30');
  const [region, setRegion] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['incident-kpis', periode, region],
    queryFn: () => api.get('/incidents/kpis', { params: { periode, region: region || undefined } }).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  const d = data ?? {};
  // Libellés métier sur les axes/légendes : jamais COUPURE_TOTALE ou MAJEUR bruts.
  const L_SEV: Record<string, string> = { CRITIQUE: 'Critique', MAJEUR: 'Majeur', MINEUR: 'Mineur', INFORMATIF: 'Informatif' };
  const parType = Object.entries(d.parType ?? {}).map(([name, value]) => ({ name: labelDe(name), value: value as number }));
  const parSeverite = Object.entries(d.parSeverite ?? {}).map(([name, value]) => ({ name: L_SEV[name] ?? name, value: value as number }));

  return (
    <div>
      <PageHeader title="KPIs Incidents" subtitle="MTTR, MTTI et taux de résolution" backHref="/incidents" />

      <FilterBar
        filters={[
          { key: 'periode', label: 'Période', sansVide: true, value: periode, options: [
            { value: '7', label: '7 jours' }, { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' },
          ], onChange: setPeriode },
          { key: 'region', label: 'Toutes régions', value: region, options: regionOptions, onChange: setRegion },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="MTTR" value={mins(d.mttr_minutes ?? 0)} subtitle="Temps moyen de résolution" icon={Timer} color="bg-[#1B3F6B]" />
        <StatCard title="MTTI" value={mins(d.mtti_minutes ?? 0)} subtitle="Temps moyen d'intervention" icon={Activity} color="bg-[#2471A3]" />
        <StatCard title="Résolus" value={`${d.resolus ?? 0}/${d.total ?? 0}`} subtitle={`${d.tauxResolutionJ1 ?? 0}% sous 24h`} icon={CheckCircle2} color="bg-[#0E7C6B]" />
        <StatCard title="En cours / ouverts" value={`${(d.ouverts ?? 0) + (d.enCours ?? 0)}`} icon={AlertTriangle} color="bg-orange-500" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-4">Répartition par type</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={parType}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#2471A3" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-4">Répartition par sévérité</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={parSeverite} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                {parSeverite.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 xl:col-span-2">
          <h3 className="font-semibold text-gray-700 text-sm mb-4">Top 10 sites les plus impactés</h3>
          <div className="space-y-2">
            {(d.top10Sites ?? []).map((s: { siteId: string; code: string; nom: string; count: number }) => (
              <div key={s.siteId} className="flex items-center gap-3 text-sm">
                <span className="font-medium text-gray-700 w-40 truncate" title={s.nom}>{s.nom}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#C0392B]" style={{ width: `${Math.min(100, (s.count / ((d.top10Sites?.[0]?.count) || 1)) * 100)}%` }} />
                </div>
                <span className="text-gray-500 w-8 text-right">{s.count}</span>
              </div>
            ))}
            {(!d.top10Sites || d.top10Sites.length === 0) && <p className="text-xs text-gray-400 text-center py-4">Aucune donnée</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
