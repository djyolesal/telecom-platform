'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Banknote, Fuel, ShieldAlert, Wrench, Zap, Clock, Leaf, Sun } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { Loading, ErrorState } from '@/components/shared/states';
import { fmtNumber, fmtFCFA } from '@/lib/utils';

const fmtDuree = (min: number | null) =>
  min == null ? '—' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60 ? (min % 60) + ' min' : ''}`.trim();

export default function DirectionPage() {
  const router = useRouter();
  const [mois, setMois] = useState('6');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-direction', mois],
    queryFn: () => api.get('/rapports/dashboard-direction', { params: { mois } }).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState message="Tableau de bord indisponible" />;
  const k = data.kpis;

  return (
    <div>
      <PageHeader title="Pilotage — Direction" subtitle="Coûts énergie, pertes et performance consolidés du parc" />

      <FilterBar
        filters={[
          { key: 'mois', label: 'Période', sansVide: true, value: mois, options: [
            { value: '3', label: '3 mois' }, { value: '6', label: '6 mois' },
            { value: '12', label: '12 mois' }, { value: '24', label: '24 mois' },
          ], onChange: setMois },
        ]}
      />

      {/* ── KPIs financiers ── */}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Coût énergie" value={fmtFCFA(k.coutEnergieFCFA)} subtitle={`${data.periodeMois} mois`} icon={Banknote} color="bg-[#1B3F6B]" />
        <StatCard title="Gasoil consommé" value={`${fmtNumber(k.gasoilLitres)} L`} subtitle={fmtFCFA(k.coutGasoilFCFA)} icon={Fuel} color="bg-[#0E7C6B]" />
        <StatCard title="Électricité CEET" value={fmtFCFA(k.coutCeetFCFA)} icon={Zap} color="bg-[#2471A3]" />
        <StatCard title="Pertes carburant" value={fmtFCFA(k.pertesCarburantFCFA)} subtitle={`${fmtNumber(k.pertesCarburantLitres)} L · ${k.partPertes}% du gasoil`} icon={ShieldAlert} color="bg-[#DC2626]" />
      </div>

      {/* ── KPIs performance ── */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Respect du préventif" value={k.tauxPreventif != null ? `${k.tauxPreventif}%` : '—'} subtitle={`${k.preventivesRealisees}/${k.preventivesPlanifiees} réalisées`} icon={Wrench} color="bg-[#0E7C6B]" />
        <StatCard title="Curatives" value={String(k.curatives)} subtitle="interventions correctives" icon={Wrench} color="bg-[#F59E0B]" />
        <StatCard title="Durée moy. coupure" value={fmtDuree(k.mttrMinutes)} subtitle="MTTR incidents" icon={Clock} color="bg-[#1B3F6B]" />
        <StatCard title="Délai moy. intervention" value={fmtDuree(k.mttaMinutes)} subtitle={`${k.incidentsOuverts} incident(s) ouvert(s)`} icon={Clock} color="bg-[#2471A3]" />
      </div>

      {/* ── Empreinte carbone ── */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Empreinte carbone</h3>
        <button onClick={() => router.push('/rapports/empreinte-carbone')} className="text-xs font-medium text-[#0E7C6B] hover:underline">Détail par mois, région et site →</button>
      </div>
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="CO₂ émis" value={`${fmtNumber(k.co2TotalTonnes)} t`} subtitle={`sur ${data.periodeMois} mois`} icon={Leaf} color="bg-[#0E7C6B]" />
        <StatCard title="dont gasoil (GE)" value={`${fmtNumber(k.co2GasoilTonnes)} t`} subtitle="combustion groupes" icon={Fuel} color="bg-[#C0392B]" />
        <StatCard title="dont réseau CEET" value={`${fmtNumber(k.co2CeetTonnes)} t`} subtitle="électricité réseau" icon={Zap} color="bg-[#2471A3]" />
        <StatCard title="Évité par le solaire" value={`${fmtNumber(k.co2EviteTonnes)} t`} subtitle="émissions évitées" icon={Sun} color="bg-[#F59E0B]" />
      </div>

      {/* ── Tendance des coûts ── */}
      <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">Coût énergie par mois (FCFA)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.serieMensuelle}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => fmtFCFA(v)} />
              <Legend />
              <Bar dataKey="coutGasoil" name="Gasoil" stackId="a" fill="#0E7C6B" radius={[0, 0, 0, 0]} />
              <Bar dataKey="coutCeet" name="CEET" stackId="a" fill="#2471A3" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">Gasoil consommé par mois (L)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.serieMensuelle}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => `${fmtNumber(v)} L`} />
              <Line type="monotone" dataKey="gasoilLitres" name="Gasoil (L)" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Par région + top sites ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Coût énergie par région</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">Région</th>
                <th className="px-3 py-2 text-right font-medium">Coût énergie</th>
                <th className="px-3 py-2 text-right font-medium">Gasoil (L)</th>
                <th className="px-3 py-2 text-right font-medium">Incidents</th>
              </tr></thead>
              <tbody>
                {data.parRegion.map((r: { region: string; coutEnergie: number; gasoilLitres: number; incidents: number }) => (
                  <tr key={r.region} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 font-medium text-gray-800">{r.region}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtFCFA(r.coutEnergie)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmtNumber(r.gasoilLitres)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.incidents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Top 10 des sites les plus coûteux (énergie)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">Site</th>
                <th className="px-3 py-2 font-medium">Région</th>
                <th className="px-3 py-2 text-right font-medium">Coût énergie</th>
              </tr></thead>
              <tbody>
                {data.topSitesCouteux.map((s: { code: string; nom: string; region: string; coutEnergie: number }) => (
                  <tr key={s.code} className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50" onClick={() => router.push(`/sites?search=${encodeURIComponent(s.nom)}`)}>
                    <td className="py-2 pr-4 font-medium text-gray-800">{s.nom}</td>
                    <td className="px-3 py-2 text-gray-600">{s.region}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtFCFA(s.coutEnergie)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
