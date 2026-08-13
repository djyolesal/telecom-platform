'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { Loading } from '@/components/shared/states';

const COLORS = ['#1B3F6B', '#0E7C6B', '#2471A3', '#F39C12', '#C0392B'];

interface ReleveRow {
  date: string;
  source: string;
  consommationKwh: number | null;
  gasoilConsommeLitres: number | null;
}

export default function EnergieRapportsPage() {
  const [periode, setPeriode] = useState('180');

  const { data, isLoading } = useQuery({
    queryKey: ['conso-rapport', periode],
    queryFn: () => api.get('/rapports/conso-energie', { params: { periode } }).then((r) => r.data.data),
  });

  const releves: ReleveRow[] = useMemo(() => data?.releves ?? [], [data]);

  const parJour = useMemo(() => {
    const map = new Map<string, { date: string; kwh: number; gasoil: number }>();
    for (const r of releves) {
      const key = format(new Date(r.date), 'dd/MM');
      const b = map.get(key) ?? { date: key, kwh: 0, gasoil: 0 };
      b.kwh += Number(r.consommationKwh ?? 0);
      b.gasoil += Number(r.gasoilConsommeLitres ?? 0);
      map.set(key, b);
    }
    return Array.from(map.values());
  }, [releves]);

  const parSource = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of releves) map.set(r.source, (map.get(r.source) ?? 0) + Number(r.consommationKwh ?? 0));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [releves]);

  return (
    <div>
      <PageHeader title="Rapports énergie" subtitle="Tendances de consommation" backHref="/energie" />

      <FilterBar
        filters={[{ key: 'periode', label: 'Période', sansVide: true, value: periode, options: [
          { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' }, { value: '180', label: '6 mois' }, { value: '365', label: '12 mois' },
        ], onChange: setPeriode }]}
      />

      {isLoading ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-100 p-5 xl:col-span-2">
            <h3 className="font-semibold text-gray-700 text-sm mb-4">Consommation kWh par jour</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={parJour}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="kwh" stroke="#2471A3" name="kWh" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-700 text-sm mb-4">Gasoil consommé par jour (L)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={parJour}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="gasoil" fill="#0E7C6B" name="Gasoil (L)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-700 text-sm mb-4">Répartition kWh par source</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={parSource} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                  {parSource.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
