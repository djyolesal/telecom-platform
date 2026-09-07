'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Fuel, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { Select } from '@/components/shared/Form';
import { Loading, EmptyState } from '@/components/shared/states';
import { regionOptions } from '@/lib/constants';
import { fmtNumber } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

interface Ligne {
  siteId: string; site: string; region: string;
  stockDebut: number; stockFin: number; livraisons: number;
  conso: number | null; consoJour: number | null; debitLh: number | null;
  gasoilInexplique: number | null; fenetreJours: number; drapeaux: string[];
}

/**
 * Bilan mensuel des stocks carburant - méthode « bilan matière » validée avec
 * l'exploitant (07/09/2026) : stocks interpolés aux frontières exactes du
 * mois, conso pro rata calendaire, contre-épreuve heures × débit (vol/fuite).
 */
export default function StocksMensuelsPage() {
  const maintenant = new Date();
  const [annee, setAnnee] = useState(String(maintenant.getFullYear()));
  const [mois, setMois] = useState(String(maintenant.getMonth() + 1));
  const [region, setRegion] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['stocks-mensuels', annee, mois, region],
    queryFn: () => api.get('/rapports/stocks-mensuels', {
      params: { annee, mois, region: region || undefined },
    }).then((r) => r.data.data as { lignes: Ligne[]; totaux: { sites: number; stockDebut: number; stockFin: number; livraisons: number; conso: number; anomalies: number } }),
  });

  const cols: Column<Ligne>[] = [
    { key: 'site', header: 'Site', render: (l) => <span className="font-medium text-gray-800">{l.site}</span> },
    { key: 'region', header: 'Région', render: (l) => l.region },
    { key: 'stockDebut', header: 'Stock au 1er (L)', align: 'right', render: (l) => fmtNumber(l.stockDebut) },
    { key: 'stockFin', header: 'Stock fin (L)', align: 'right', render: (l) => fmtNumber(l.stockFin) },
    { key: 'livraisons', header: 'Livraisons (L)', align: 'right', render: (l) => fmtNumber(l.livraisons) },
    { key: 'conso', header: 'Conso (L)', align: 'right', render: (l) => l.conso != null ? fmtNumber(l.conso) : '—' },
    { key: 'consoJour', header: 'Conso/j', align: 'right', render: (l) => l.consoJour != null ? `${l.consoJour} L/j` : '—' },
    { key: 'debitLh', header: 'Débit', align: 'right', render: (l) => l.debitLh != null ? `${l.debitLh} L/h` : '—' },
    {
      key: 'inexplique', header: 'Non expliqué', align: 'right',
      render: (l) => l.gasoilInexplique != null
        ? <span className="font-semibold text-red-600" title="Gasoil sorti de la cuve sans marche du GE correspondante : vol, fuite ou index bloqué - à vérifier sur site.">{fmtNumber(l.gasoilInexplique)} L</span>
        : '—',
    },
    {
      key: 'obs', header: 'Observations',
      render: (l) => l.drapeaux.length
        ? <span className="text-xs text-amber-700" title={l.drapeaux.join(' · ')}>{l.drapeaux.join(' · ')}</span>
        : '',
    },
  ];

  const t = data?.totaux;
  const anneesOptions = [0, 1].map((i) => {
    const a = String(maintenant.getFullYear() - i);
    return { value: a, label: a };
  });

  return (
    <div>
      <PageHeader
        title="Stocks carburant mensuels"
        subtitle="Bilan matière par site : stocks aux frontières du mois, consommation et contre-épreuve vol/fuite"
        backHref="/rapports"
        actions={
          <ExportButtons base="/rapports/stocks-mensuels/export"
            name={`Stocks carburant ${MOIS[Number(mois)] ?? mois} ${annee}`}
            query={`annee=${annee}&mois=${mois}${region ? `&region=${encodeURIComponent(region)}` : ''}`} />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-36"><Select value={mois} onChange={(e) => setMois(e.target.value)} options={MOIS.slice(1).map((m, i) => ({ value: String(i + 1), label: m }))} /></div>
        <div className="w-28"><Select value={annee} onChange={(e) => setAnnee(e.target.value)} options={anneesOptions} /></div>
        <div className="w-44"><Select value={region} onChange={(e) => setRegion(e.target.value)} options={regionOptions} placeholder="Toutes régions" /></div>
      </div>

      {t && (
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard title="Stock au 1er" value={`${fmtNumber(t.stockDebut)} L`} subtitle={`${t.sites} sites`} icon={Fuel} color="bg-[#1B3F6B]" />
          <StatCard title="Stock fin de mois" value={`${fmtNumber(t.stockFin)} L`} subtitle="interpolé au dernier jour" icon={Fuel} color="bg-[#0E7C6B]" />
          <StatCard title="Livraisons" value={`${fmtNumber(t.livraisons)} L`} subtitle="dépotages du mois" icon={Fuel} color="bg-[#2471A3]" />
          <StatCard title="Consommation" value={`${fmtNumber(t.conso)} L`} subtitle="bilan matière pro rata" icon={Fuel} color="bg-[#7D3C98]" />
          <StatCard title="À vérifier" value={String(t.anomalies)} subtitle="gasoil non expliqué, index, jauges" icon={TriangleAlert} color={t.anomalies ? 'bg-[#B23124]' : 'bg-[#0E7C6B]'} />
        </div>
      )}

      {isLoading ? <Loading /> : !data?.lignes.length ? (
        <EmptyState title="Aucun site calculable sur ce mois" hint="Il faut au moins un relevé de niveau de cuve dans le mois (et idéalement un antérieur)." />
      ) : (
        <>
          <DataTable columns={cols} data={data.lignes} rowKey={(l) => l.siteId}
            rowClassName={(l) => l.gasoilInexplique != null ? 'bg-red-50' : undefined} />
          <p className="mt-2 text-xs text-gray-400">
            Méthode : consommation = niveau antérieur + livraisons − niveau du mois, sur une fenêtre d&apos;au moins 10 jours (élargie sinon), rapportée aux jours calendaires ;
            stocks aux frontières interpolés par la conso/j. « Non expliqué » compare la conso mesurée aux heures de marche du GE × son débit habituel — un écart fort signale un vol, une fuite ou un index bloqué.
          </p>
        </>
      )}
    </div>
  );
}
