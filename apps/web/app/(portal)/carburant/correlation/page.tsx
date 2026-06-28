'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Droplet, Flame } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Loading, EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { regionOptions } from '@/lib/constants';
import { fmtNumber } from '@/lib/utils';

interface Ligne {
  siteId: string; code: string; nom: string; region: string;
  livreLitres: number; consommeLitres: number; ecartLitres: number;
  heuresGE: number; consoKwh: number; ratio: number | null; anomalie: boolean;
}

const PERIODES = [
  { value: '90', label: '90 jours' },
  { value: '180', label: '180 jours' },
  { value: '365', label: '1 an' },
];

export default function CorrelationCarburantPage() {
  const [region, setRegion] = useState('');
  const [periode, setPeriode] = useState('180');

  const { data, isLoading } = useQuery({
    queryKey: ['correlation-carburant', region, periode],
    queryFn: () => api.get('/rapports/correlation-carburant', { params: { region: region || undefined, periode } }).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  const totaux = data?.totaux ?? { livreLitres: 0, consommeLitres: 0, ecartLitres: 0 };
  let lignes: Ligne[] = data?.lignes ?? [];
  // Sites sans aucune activité (ni livré ni consommé) en bas.
  lignes = [...lignes].sort((a, b) => Number(b.anomalie) - Number(a.anomalie) || (b.livreLitres + b.consommeLitres) - (a.livreLitres + a.consommeLitres));

  const columns: Column<Ligne>[] = [
    { key: 'code', header: 'Site', render: (l) => <span className="font-medium text-gray-800">{l.code}</span> },
    { key: 'nom', header: 'Nom', render: (l) => <span className="text-gray-600">{l.nom}</span> },
    { key: 'region', header: 'Région' },
    { key: 'livre', header: 'Livré (L)', align: 'right', render: (l) => fmtNumber(l.livreLitres) },
    { key: 'consomme', header: 'Consommé GE (L)', align: 'right', render: (l) => fmtNumber(l.consommeLitres) },
    { key: 'ecart', header: 'Écart (L)', align: 'right', render: (l) => <span className={l.ecartLitres < 0 ? 'text-red-600 font-medium' : 'text-gray-700'}>{l.ecartLitres > 0 ? '+' : ''}{fmtNumber(l.ecartLitres)}</span> },
    { key: 'heures', header: 'Heures GE', align: 'right', render: (l) => fmtNumber(l.heuresGE) },
    { key: 'ratio', header: 'Livré/Consommé', align: 'center', render: (l) => l.ratio != null ? `${l.ratio.toFixed(2)}×` : '—' },
    { key: 'anomalie', header: 'Alerte', align: 'center', render: (l) => l.anomalie ? <Badge className="bg-red-100 text-red-700">Anomalie</Badge> : <span className="text-gray-300">—</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Corrélation approvisionnement ↔ consommation"
        subtitle="Carburant livré (dépotages) vs gasoil consommé par les GE, par site"
        backHref="/carburant/commandes"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total livré" value={`${fmtNumber(Math.round(totaux.livreLitres / 1000))}k L`} icon={Droplet} color="bg-[#2471A3]" />
        <StatCard title="Total consommé GE" value={`${fmtNumber(Math.round(totaux.consommeLitres / 1000))}k L`} icon={Flame} color="bg-[#0E7C6B]" />
        <StatCard title="Écart global" value={`${fmtNumber(Math.round(totaux.ecartLitres / 1000))}k L`} icon={Droplet} color="bg-[#1B3F6B]" />
        <StatCard title="Sites en anomalie" value={String(data?.nbAnomalies ?? 0)} icon={AlertTriangle} color="bg-[#C0392B]" />
      </div>

      <FilterBar
        filters={[
          { key: 'region', label: 'Toutes régions', value: region, options: regionOptions, onChange: setRegion },
          { key: 'periode', label: 'Période', value: periode, options: PERIODES, onChange: setPeriode },
        ]}
      />

      <div className="mb-3 text-xs text-gray-500">
        Une <span className="font-medium text-red-600">anomalie</span> signale une consommation GE nettement supérieure au carburant livré (ratio &lt; 0,85) — à vérifier : pertes, vol, dépotage non enregistré ou heures GE surévaluées.
      </div>

      {lignes.length === 0 ? (
        <EmptyState title="Aucune donnée" hint="Aucun dépotage ni relevé énergie sur la période." />
      ) : (
        <DataTable columns={columns} data={lignes} />
      )}
    </div>
  );
}
