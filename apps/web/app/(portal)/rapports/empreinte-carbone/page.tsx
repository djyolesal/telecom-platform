'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Leaf, Factory, Zap, Sun } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { Loading, ErrorState } from '@/components/shared/states';
import { fmtNumber } from '@/lib/utils';

const fmtT = (kg: number) => `${(kg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t`;

interface RegionRow { region: string; co2TotalKg: number; co2GasoilKg: number; co2CeetKg: number }
interface SiteRow { code: string; nom: string; region: string; co2TotalKg: number }

export default function EmpreinteCarbonePage() {
  const router = useRouter();
  const [mois, setMois] = useState('6');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['empreinte-carbone', mois],
    queryFn: () => api.get('/rapports/empreinte-carbone', { params: { mois } }).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState message="Empreinte carbone indisponible" />;
  const t = data.totaux;
  const f = data.facteurs;

  // Série mensuelle convertie en tonnes pour l'affichage.
  const serie = data.serieMensuelle.map((s: { mois: string; co2Gasoil: number; co2Ceet: number }) => ({
    mois: s.mois,
    gasoil: Math.round((s.co2Gasoil / 1000) * 100) / 100,
    ceet: Math.round((s.co2Ceet / 1000) * 100) / 100,
  }));

  return (
    <div>
      <PageHeader
        title="Empreinte carbone"
        subtitle="Émissions de CO₂ du parc, dérivées des relevés d’énergie — gasoil (GE), réseau CEET, et solaire"
        backHref="/rapports"
      />

      <FilterBar
        filters={[
          { key: 'mois', label: 'Période', value: mois, options: [
            { value: '3', label: '3 mois' }, { value: '6', label: '6 mois' },
            { value: '12', label: '12 mois' }, { value: '24', label: '24 mois' },
          ], onChange: setMois },
        ]}
      />

      {/* ── KPIs CO₂ ── */}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Total émis" value={fmtT(t.co2TotalKg)} subtitle={`CO₂ · ${data.periodeMois} mois`} icon={Leaf} color="bg-[#0E7C6B]" />
        <StatCard title="Gasoil (GE)" value={fmtT(t.co2GasoilKg)} subtitle={`${fmtNumber(t.gasoilLitres)} L · ${t.partGePct}% du total`} icon={Factory} color="bg-[#C0392B]" />
        <StatCard title="Réseau CEET" value={fmtT(t.co2CeetKg)} subtitle={`${fmtNumber(t.ceetKwh)} kWh`} icon={Zap} color="bg-[#2471A3]" />
        <StatCard title="Évité par le solaire" value={fmtT(t.co2EviteKg)} subtitle={`${fmtNumber(t.solaireKwh)} kWh solaires`} icon={Sun} color="bg-[#F59E0B]" />
      </div>

      <p className="mb-6 text-xs text-gray-400">
        Facteurs d’émission appliqués : gasoil <b>{f.gasoilKgCO2L} kgCO₂/L</b>, réseau CEET <b>{f.reseauKgCO2Kwh} kgCO₂/kWh</b>, solaire 0 —
        modifiables dans Administration → Paramètres. « Évité par le solaire » = énergie solaire × facteur réseau (émissions non émises par rapport au réseau).
      </p>

      {/* ── Tendance mensuelle ── */}
      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Émissions de CO₂ par mois (tonnes)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={serie}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v} t`} />
            <Tooltip formatter={(v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} t`} />
            <Legend />
            <Bar dataKey="gasoil" name="Gasoil (GE)" stackId="a" fill="#C0392B" radius={[0, 0, 0, 0]} />
            <Bar dataKey="ceet" name="Réseau CEET" stackId="a" fill="#2471A3" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Par région + top sites ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Émissions par région</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">Région</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Gasoil</th>
                <th className="px-3 py-2 text-right font-medium">Réseau</th>
              </tr></thead>
              <tbody>
                {data.parRegion.map((r: RegionRow) => (
                  <tr key={r.region} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 font-medium text-gray-800">{r.region}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtT(r.co2TotalKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmtT(r.co2GasoilKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmtT(r.co2CeetKg)}</td>
                  </tr>
                ))}
                {data.parRegion.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-gray-400">Aucun relevé sur la période</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Top 10 des sites émetteurs</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">Site</th>
                <th className="px-3 py-2 font-medium">Région</th>
                <th className="px-3 py-2 text-right font-medium">CO₂</th>
              </tr></thead>
              <tbody>
                {data.topSites.map((s: SiteRow) => (
                  <tr key={s.code} className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50" onClick={() => router.push(`/sites?search=${encodeURIComponent(s.nom)}`)}>
                    <td className="py-2 pr-4 font-medium text-gray-800">{s.nom}</td>
                    <td className="px-3 py-2 text-gray-600">{s.region}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtT(s.co2TotalKg)}</td>
                  </tr>
                ))}
                {data.topSites.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-gray-400">Aucun relevé sur la période</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
