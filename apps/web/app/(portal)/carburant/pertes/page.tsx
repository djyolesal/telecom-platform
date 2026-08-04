'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Droplets, Banknote, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Loading, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { fmtNumber, fmtFCFA } from '@/lib/utils';

interface Anomalie {
  siteId: string; code: string; nom: string; region: string;
  nbDepotages: number; nbAnomalies: number;
  volumeLivreLitres: number; perteSurconsoLitres: number; perteLivraisonLitres: number;
  perteTotaleLitres: number; perteFCFA: number;
  score: number; niveau: 'OK' | 'A_SURVEILLER' | 'SUSPECT' | 'CRITIQUE'; facteurs: string[];
}

const NIVEAU: Record<string, { label: string; cls: string }> = {
  CRITIQUE:     { label: 'Critique',     cls: 'bg-red-100 text-red-700' },
  SUSPECT:      { label: 'Suspect',      cls: 'bg-orange-100 text-orange-700' },
  A_SURVEILLER: { label: 'À surveiller', cls: 'bg-amber-100 text-amber-700' },
  OK:           { label: 'OK',           cls: 'bg-gray-100 text-gray-500' },
};

export default function PertesCarburantPage() {
  const router = useRouter();
  const [jours, setJours] = useState('90');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['anomalies-carburant', jours],
    queryFn: () => api.get('/rapports/anomalies-carburant', { params: { jours } }).then((r) => r.data),
  });

  const rows: Anomalie[] = data?.data ?? [];
  const meta = data?.meta ?? {};

  const columns: Column<Anomalie>[] = [
    { key: 'site', header: 'Site', render: (a) => <span className="font-medium text-gray-800">{a.nom}</span> },
    { key: 'region', header: 'Région', render: (a) => a.region },
    {
      key: 'niveau', header: 'Niveau', render: (a) => (
        <span className="inline-flex items-center gap-2">
          <Badge className={NIVEAU[a.niveau]?.cls}>{NIVEAU[a.niveau]?.label ?? a.niveau}</Badge>
          <span className="text-xs text-gray-400">score {a.score}</span>
        </span>
      ),
    },
    {
      key: 'perte', header: 'Perte estimée', render: (a) => (
        <span>
          <span className="font-semibold text-gray-800">{fmtNumber(a.perteTotaleLitres)} L</span>
          <span className="ml-1.5 text-xs text-gray-400">≈ {fmtFCFA(a.perteFCFA)}</span>
        </span>
      ),
    },
    {
      key: 'detail', header: 'Nature', render: (a) => (
        <span className="text-xs text-gray-500">
          {a.perteSurconsoLitres > 0 && <>surconso {fmtNumber(a.perteSurconsoLitres)} L</>}
          {a.perteSurconsoLitres > 0 && a.perteLivraisonLitres > 0 && ' · '}
          {a.perteLivraisonLitres > 0 && <>livraison {fmtNumber(a.perteLivraisonLitres)} L</>}
        </span>
      ),
    },
    { key: 'recur', header: 'Récurrence', render: (a) => <span className="text-sm text-gray-600">{a.nbAnomalies}/{a.nbDepotages}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Pertes de carburant"
        subtitle="Sites suspects de siphonnage ou de manquant à la livraison, par score de risque"
      />

      <FilterBar
        filters={[
          { key: 'jours', label: 'Période', value: jours, options: [
            { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' },
            { value: '180', label: '6 mois' }, { value: '365', label: '12 mois' },
          ], onChange: setJours },
        ]}
      />

      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Sites à risque" value={String(meta.nbSites ?? 0)} icon={ShieldAlert} color="bg-[#1B3F6B]" />
        <StatCard title="Critiques" value={String(meta.critiques ?? 0)} icon={TriangleAlert} color="bg-[#DC2626]" />
        <StatCard title="Gasoil perdu" value={`${fmtNumber(meta.totalPerteLitres)} L`} icon={Droplets} color="bg-[#0E7C6B]" />
        <StatCard title="Perte estimée" value={fmtFCFA(meta.totalPerteFCFA)} icon={Banknote} color="bg-[#F59E0B]" />
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucune anomalie détectée" hint="Aucun site ne présente d'écart de carburant suspect sur la période." />
      ) : (
        <>
          <DataTable columns={columns} data={rows} onRowClick={(a) => router.push(`/sites/${a.siteId}`)} />
          <p className="mt-3 text-xs text-gray-400">
            Score fondé sur les écarts réconciliés à chaque dépotage (surconsommation hors combustion GE, manquant à la livraison),
            pondérés par leur récurrence. Un score élevé appelle un contrôle terrain, ce n&apos;est pas une preuve.
          </p>
        </>
      )}
    </div>
  );
}
