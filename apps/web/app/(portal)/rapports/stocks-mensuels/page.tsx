'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Fuel, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
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
  stockDebut: number; stockFin: number; livraisons: number; mouvements: number;
  conso: number | null; consoJour: number | null; debitLh: number | null;
  gasoilInexplique: number | null; fenetreJours: number; drapeaux: string[];
  /** Saisies du mois encore à vérifier sur ce site (contrôle de vraisemblance). */
  anomalies: { nb: number; codes: string[] } | null;
}

/** Libellés courts des codes de vraisemblance, pour l'infobulle. */
const LIBELLE_CODE: Record<string, string> = {
  CUVE_DEPASSEE: 'niveau au-dessus de la capacité de la cuve',
  STOCK_AVANT_CUVE: 'stock avant dépotage au-dessus de la cuve',
  STOCK_APRES_CUVE: 'stock après dépotage au-dessus de la cuve',
  STOCK_AVANT_HAUSSE: 'le stock monte sans livraison',
  DEPOTAGE_DOUBLON: 'livraison peut-être comptée deux fois',
  INDEX_GE_RECULE: "l'index d'heures GE recule",
  HEURES_GE_ABERRANTES: "bond d'heures GE supérieur au temps écoulé",
};

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
    }).then((r) => r.data.data as { lignes: Ligne[]; totaux: { sites: number; stockDebut: number; stockFin: number; livraisons: number; mouvements: number; conso: number; anomalies: number; sitesSaisiesSignalees: number } }),
  });

  const cols: Column<Ligne>[] = [
    { key: 'site', header: 'Site', render: (l) => <span className="font-medium text-gray-800">{l.site}</span> },
    { key: 'region', header: 'Région', render: (l) => l.region },
    { key: 'stockDebut', header: 'Stock au 1er (L)', align: 'right', render: (l) => fmtNumber(l.stockDebut) },
    { key: 'stockFin', header: 'Stock fin (L)', align: 'right', render: (l) => fmtNumber(l.stockFin) },
    { key: 'livraisons', header: 'Livraisons (L)', align: 'right', render: (l) => fmtNumber(l.livraisons) },
    {
      // Colonne à part, et non fondue dans les livraisons : un transfert ou une
      // purge sort de la cuve sans passer par le moteur. Les confondre revenait
      // à facturer au site une consommation qu'il n'a pas eue.
      key: 'mouvements', header: 'Transf./purges (L)', align: 'right',
      render: (l) => l.mouvements
        ? <span className={l.mouvements < 0 ? 'text-amber-700' : 'text-teal-700'} title="Transferts nets et purges validés du mois : retirés de la consommation.">{fmtNumber(l.mouvements)}</span>
        : <span className="text-gray-300">-</span>,
    },
    { key: 'conso', header: 'Conso (L)', align: 'right', render: (l) => l.conso != null ? fmtNumber(l.conso) : '-' },
    { key: 'consoJour', header: 'Conso/j', align: 'right', render: (l) => l.consoJour != null ? `${l.consoJour} L/j` : '-' },
    { key: 'debitLh', header: 'Débit', align: 'right', render: (l) => l.debitLh != null ? `${l.debitLh} L/h` : '-' },
    {
      key: 'inexplique', header: 'Non expliqué', align: 'right',
      render: (l) => l.gasoilInexplique != null
        ? <span className="font-semibold text-red-600" title="Gasoil sorti de la cuve sans marche du GE correspondante : vol, fuite ou index bloqué - à vérifier sur site.">{fmtNumber(l.gasoilInexplique)} L</span>
        : '-',
    },
    {
      // LE CHIFFRE REPOSE SUR CES SAISIES : une jauge signalée « au-dessus de la
      // capacité » entre dans le stock publié exactement comme une jauge saine.
      // On ne l'écarte pas - c'est une décision d'exploitation - mais on ne la
      // publie plus en silence.
      key: 'saisies', header: 'Saisies', align: 'center',
      render: (l) => l.anomalies
        ? (
          <Link href={`/supervision/anomalies?site_id=${l.siteId}`}
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200"
            title={`À vérifier : ${l.anomalies.codes.map((c) => LIBELLE_CODE[c] ?? c).join(' · ')}`}>
            <TriangleAlert size={11} /> {l.anomalies.nb}
          </Link>
        )
        : <span className="text-gray-300">-</span>,
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
          <StatCard title="Stock au 1er" value={`${fmtNumber(t.stockDebut)} L`} subtitle={`${t.sites} sites`} icon={Fuel} color="bg-[rgb(var(--brand))]" />
          <StatCard title="Stock fin de mois" value={`${fmtNumber(t.stockFin)} L`} subtitle="interpolé au dernier jour" icon={Fuel} color="bg-[rgb(var(--accent))]" />
          <StatCard title="Livraisons" value={`${fmtNumber(t.livraisons)} L`} subtitle={t.mouvements ? `dépotages · ${fmtNumber(t.mouvements)} L transférés/purgés` : 'dépotages du mois'} icon={Fuel} color="bg-[rgb(var(--brand-light))]" />
          <StatCard title="Consommation" value={`${fmtNumber(t.conso)} L`} subtitle="bilan matière pro rata" icon={Fuel} color="bg-[#7D3C98]" />
          <StatCard title="À vérifier" value={String(t.anomalies)}
            subtitle={t.sitesSaisiesSignalees ? `dont ${t.sitesSaisiesSignalees} site(s) à saisies signalées` : 'gasoil non expliqué, index, jauges'}
            icon={TriangleAlert} color={t.anomalies ? 'bg-[#B23124]' : 'bg-[rgb(var(--accent))]'} />
        </div>
      )}

      {isLoading ? <Loading /> : !data?.lignes.length ? (
        <EmptyState title="Aucun site calculable sur ce mois" hint="Il faut au moins un relevé de niveau de cuve dans le mois (et idéalement un antérieur)." />
      ) : (
        <>
          <DataTable columns={cols} data={data.lignes} rowKey={(l) => l.siteId}
            rowClassName={(l) => l.gasoilInexplique != null ? 'bg-red-50' : l.anomalies ? 'bg-amber-50/60' : undefined} />
          <p className="mt-2 text-xs text-gray-400">
            Méthode : consommation = niveau antérieur + livraisons + transferts/purges − niveau du mois, sur une fenêtre d&apos;au moins 10 jours (élargie sinon), rapportée aux jours calendaires ;
            stocks aux frontières interpolés par la conso/j. « Non expliqué » compare la conso mesurée aux heures de marche du GE × son débit habituel - un écart fort signale un vol, une fuite ou un index bloqué.
          </p>
        </>
      )}
    </div>
  );
}
