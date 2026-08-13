'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Loading, EmptyState } from '@/components/shared/states';

interface Ligne {
  prestataireId: string;
  prestataireNom: string;
  total: number;
  conformes: number;
  nonConformes: number;
  tauxConformite: number;
}

function tauxColor(t: number) {
  if (t >= 90) return 'text-green-600';
  if (t >= 70) return 'text-orange-500';
  return 'text-red-600';
}

export default function ConformitePage() {
  const [periode, setPeriode] = useState('90');

  const { data, isLoading } = useQuery({
    queryKey: ['conformite', periode],
    queryFn: () => api.get('/rapports/conformite', { params: { periode } }).then((r) => r.data.data),
  });

  const t = data?.totaux ?? {};
  const lignes: Ligne[] = data?.parPrestataire ?? [];

  const columns: Column<Ligne>[] = [
    { key: 'prestataireNom', header: 'Prestataire', render: (l) => <span className="font-medium text-gray-800">{l.prestataireNom}</span> },
    { key: 'total', header: 'Passives clôturées', align: 'center' },
    { key: 'conformes', header: 'Avec relevés', align: 'center', render: (l) => <span className="text-green-600">{l.conformes}</span> },
    { key: 'nonConformes', header: 'Sans relevés', align: 'center', render: (l) => <span className={l.nonConformes > 0 ? 'text-red-600' : 'text-gray-400'}>{l.nonConformes}</span> },
    {
      key: 'taux', header: 'Conformité', render: (l) => (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden min-w-16">
            <div className={`h-full ${l.tauxConformite >= 90 ? 'bg-green-500' : l.tauxConformite >= 70 ? 'bg-orange-400' : 'bg-red-500'}`} style={{ width: `${l.tauxConformite}%` }} />
          </div>
          <span className={`text-sm font-semibold w-10 text-right ${tauxColor(l.tauxConformite)}`}>{l.tauxConformite}%</span>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Conformité maintenances passives"
        subtitle="Maintenances passives clôturées avec relevés énergie, par prestataire"
        backHref="/rapports"
      />

      <FilterBar
        filters={[
          { key: 'periode', label: 'Période', sansVide: true, value: periode, options: [
            { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' },
            { value: '180', label: '6 mois' }, { value: '365', label: '12 mois' },
          ], onChange: setPeriode },
        ]}
      />

      {isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard title="Passives clôturées" value={t.total ?? 0} icon={ClipboardCheck} color="bg-[#1B3F6B]" />
            <StatCard title="Conformes" value={t.conformes ?? 0} subtitle="avec relevés" icon={CheckCircle2} color="bg-[#0E7C6B]" />
            <StatCard title="Non conformes" value={t.nonConformes ?? 0} subtitle="sans relevés" icon={XCircle} color={t.nonConformes > 0 ? 'bg-red-500' : 'bg-gray-400'} />
            <StatCard title="Taux global" value={`${t.tauxConformite ?? 0}%`} icon={ClipboardCheck} color="bg-[#2471A3]" />
          </div>

          {lignes.length === 0 ? (
            <EmptyState title="Aucune maintenance passive clôturée sur la période" />
          ) : (
            <DataTable columns={columns} data={lignes} rowKey={(l) => l.prestataireId} />
          )}
        </>
      )}
    </div>
  );
}
