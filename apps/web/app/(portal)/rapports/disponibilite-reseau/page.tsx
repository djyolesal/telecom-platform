'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { WifiOff, Activity, Zap, RadioTower } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { Loading, ErrorState } from '@/components/shared/states';
import { fmtNumber } from '@/lib/utils';

interface SiteRow { nom: string; region: string; coupures: number; enCours: number; downtimeHeures: number; dispoPct: number }
interface AlarmeRow { type: string; coupures: number; downtimeHeures: number }

export default function DisponibiliteReseauPage() {
  const router = useRouter();
  const [mois, setMois] = useState('3');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['disponibilite-reseau', mois],
    queryFn: () => api.get('/rapports/disponibilite-reseau', { params: { mois } }).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState message="Disponibilité réseau indisponible" />;
  const k = data.kpis;

  return (
    <div>
      <PageHeader
        title="Disponibilité réseau"
        subtitle="Coupures radio (supervision NOC) : downtime, sites touchés et part imputable à l'énergie"
        backHref="/rapports"
      />

      <FilterBar
        filters={[{
          key: 'mois', label: 'Période', value: mois, options: [
            { value: '1', label: '1 mois' }, { value: '3', label: '3 mois' },
            { value: '6', label: '6 mois' }, { value: '12', label: '12 mois' },
          ], onChange: setMois,
        }]}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard title="Coupures" value={fmtNumber(k.coupures)} subtitle={`${k.sitesTouches}/${k.nbSites} sites touchés`} icon={WifiOff} color="bg-[#1B3F6B]" />
        <StatCard title="En cours" value={fmtNumber(k.enCours)} subtitle="non rétablies" icon={Activity} color="bg-[#C0392B]" />
        <StatCard title="Downtime cumulé" value={`${fmtNumber(k.downtimeHeures)} h`} subtitle={`sur ${data.periodeMois} mois`} icon={RadioTower} color="bg-[#E67E22]" />
        <StatCard title="Part énergie" value={`${k.partEnergiePct}%`} subtitle="alarmes AE / GE / EN" icon={Zap} color="bg-[#0E7C6B]" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Top sites par downtime</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">Site</th>
                <th className="px-3 py-2 font-medium">Région</th>
                <th className="px-3 py-2 text-right font-medium">Coupures</th>
                <th className="px-3 py-2 text-right font-medium">Downtime</th>
                <th className="px-3 py-2 text-right font-medium">Dispo</th>
              </tr></thead>
              <tbody>
                {data.topSites.map((s: SiteRow) => (
                  <tr key={s.nom} className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50"
                    onClick={() => router.push(`/supervision/coupures?search=${encodeURIComponent(s.nom)}`)}>
                    <td className="py-2 pr-4 font-medium text-gray-800">
                      {s.nom}{s.enCours > 0 && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{s.enCours} en cours</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{s.region}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.coupures}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtNumber(s.downtimeHeures)} h</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${s.dispoPct < 95 ? 'text-red-600' : s.dispoPct < 99 ? 'text-amber-600' : 'text-emerald-600'}`}>{s.dispoPct}%</td>
                  </tr>
                ))}
                {data.topSites.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-gray-400">Aucune coupure sur la période</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">Downtime par type d'alarme (heures)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.parTypeAlarme} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="type" width={46} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number, name) => name === 'downtimeHeures' ? [`${fmtNumber(v)} h`, 'Downtime'] : [v, name]} />
              <Bar dataKey="downtimeHeures" name="Downtime (h)" fill="#1B3F6B" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-gray-400">AE / GE / EN = causes énergie · FO = fibre · TX = transmission · RA = radio (référentiel NOC).</p>
        </div>
      </div>
    </div>
  );
}
