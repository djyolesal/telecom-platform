'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Zap, Fuel, Clock, Banknote } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { ButtonLink } from '@/components/shared/Button';
import { Loading } from '@/components/shared/states';
import { fmtNumber, fmtFCFA } from '@/lib/utils';

export default function EnergiePage() {
  const [periode, setPeriode] = useState('180');

  const { data, isLoading } = useQuery({
    queryKey: ['conso-energie', periode],
    queryFn: () => api.get('/rapports/conso-energie', { params: { periode } }).then((r) => r.data.data),
  });

  const t = data?.totaux ?? {};

  return (
    <div>
      <PageHeader
        title="Énergie"
        subtitle="Consommation électrique & gasoil du parc"
        actions={
          <>
            <ButtonLink href="/energie/releves" variant="secondary">Relevés</ButtonLink>
            <ButtonLink href="/energie/rapports" variant="secondary">Graphiques</ButtonLink>
          </>
        }
      />

      <FilterBar
        filters={[
          { key: 'periode', label: 'Période', value: periode, options: [
            { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' },
            { value: '180', label: '6 mois' }, { value: '365', label: '12 mois' },
          ], onChange: setPeriode },
        ]}
      />

      {isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Consommation" value={`${fmtNumber(t.consoKwh)} kWh`} icon={Zap} color="bg-[#2471A3]" />
            <StatCard title="Gasoil consommé" value={`${fmtNumber(t.gasoilLitres)} L`} icon={Fuel} color="bg-[#0E7C6B]" />
            <StatCard title="Heures GE" value={`${fmtNumber(t.heuresGE)} h`} icon={Clock} color="bg-[#1B3F6B]" />
            <StatCard title="Coût estimé" value={fmtFCFA(t.coutFCFA)} icon={Banknote} color="bg-[#1B3F6B]" />
          </div>
          <p className="mt-4 text-xs text-gray-400">{fmtNumber(data?.nbReleves)} relevés sur la période sélectionnée.</p>
        </>
      )}
    </div>
  );
}
