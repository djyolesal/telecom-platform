'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Droplets, Banknote, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
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
  litresNonExpliques: number; perteFCFA: number;
  origine: 'BILAN_MATIERE' | 'DEPOTAGES' | 'AUCUNE';
  score: number;
  niveau: 'OK' | 'A_SURVEILLER' | 'SUSPECT' | 'CRITIQUE' | 'A_FIABILISER';
  facteurs: string[];
  saisiesSignalees: number;
  depotages: { nb: number; anormaux: number; surconso: number; livraison: number };
}

const NIVEAU: Record<string, { label: string; cls: string }> = {
  CRITIQUE:      { label: 'Critique',      cls: 'bg-red-100 text-red-700' },
  SUSPECT:       { label: 'Suspect',       cls: 'bg-orange-100 text-orange-700' },
  // Ni accusé ni blanchi : la mesure elle-même est en attente de vérification.
  A_FIABILISER:  { label: 'À fiabiliser',  cls: 'bg-amber-100 text-amber-800' },
  A_SURVEILLER:  { label: 'À surveiller',  cls: 'bg-yellow-50 text-yellow-700' },
  OK:            { label: 'OK',            cls: 'bg-gray-100 text-gray-500' },
};

/** D'où sort le chiffre retenu : une mesure ne se lit pas comme une estimation. */
const ORIGINE: Record<string, { label: string; aide: string }> = {
  BILAN_MATIERE: { label: 'bilan matière', aide: "Gasoil réellement sorti de la cuve, confronté aux heures de marche du GE. C'est une mesure." },
  DEPOTAGES:     { label: 'écarts dépotages', aide: 'Écarts réconciliés livraison par livraison, faute de bilan matière calculable.' },
  AUCUNE:        { label: '-', aide: '' },
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
      key: 'perte', header: 'Gasoil non expliqué', render: (a) => (
        <span>
          <span className="font-semibold text-gray-800">{fmtNumber(a.litresNonExpliques)} L</span>
          <span className="ml-1.5 text-xs text-gray-400">≈ {fmtFCFA(a.perteFCFA)}</span>
        </span>
      ),
    },
    {
      key: 'origine', header: 'Établi par', render: (a) => (
        <span className="text-xs text-gray-500" title={ORIGINE[a.origine]?.aide}>{ORIGINE[a.origine]?.label ?? a.origine}</span>
      ),
    },
    {
      key: 'detail', header: 'Facteurs', render: (a) => (
        <span className="block max-w-[320px] truncate text-xs text-gray-500" title={a.facteurs.join('\n')}>
          {a.facteurs.join(' · ')}
        </span>
      ),
    },
    {
      key: 'saisies', header: 'Saisies', align: 'center', render: (a) => a.saisiesSignalees
        ? (
          <Link href={`/supervision/anomalies?site_id=${a.siteId}`} onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200"
            title="Saisies à vérifier sur ce site : le verdict est suspendu tant qu'elles ne sont pas tranchées.">
            <TriangleAlert size={11} /> {a.saisiesSignalees}
          </Link>
        )
        : <span className="text-gray-300">-</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Pertes de carburant"
        subtitle="Gasoil non expliqué par site : un seul verdict, établi par le bilan matière ou, à défaut, par les écarts aux dépotages"
      />

      <FilterBar
        filters={[
          { key: 'jours', label: 'Période', sansVide: true, value: jours, options: [
            { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' },
            { value: '180', label: '6 mois' }, { value: '365', label: '12 mois' },
          ], onChange: setJours },
        ]}
      />

      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Sites à risque" value={String(meta.nbSites ?? 0)} icon={ShieldAlert} color="bg-[rgb(var(--brand))]" />
        <StatCard title="Critiques" value={String(meta.critiques ?? 0)} subtitle={meta.aFiabiliser ? `${meta.aFiabiliser} à fiabiliser d'abord` : undefined} icon={TriangleAlert} color="bg-[#DC2626]" />
        <StatCard title="Gasoil perdu" value={`${fmtNumber(meta.totalPerteLitres)} L`} icon={Droplets} color="bg-[rgb(var(--accent))]" />
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
            Verdict unique : le <b>bilan matière</b> (gasoil réellement sorti de la cuve face aux heures de marche du GE, méthode
            validée le 07/09/2026) tranche quand il est calculable ; à défaut, les <b>écarts réconciliés aux dépotages</b> prennent
            le relais. La consommation théorique kVA n&apos;est qu&apos;un budget : elle n&apos;entre jamais dans le verdict.
            Un site dont des saisies restent à vérifier passe « à fiabiliser » - on ne conclut pas sur une mesure douteuse.
            Un niveau élevé appelle un contrôle terrain, ce n&apos;est pas une preuve.
          </p>
        </>
      )}
    </div>
  );
}
