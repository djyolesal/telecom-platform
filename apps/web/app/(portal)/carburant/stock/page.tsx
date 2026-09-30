'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Fuel, AlertTriangle, Droplet, Banknote, History, Truck } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { ButtonLink } from '@/components/shared/Button';
import { Loading, EmptyState } from '@/components/shared/states';
import { NiveauStockBadge } from '@/components/shared/Badge';
import { regionOptions } from '@/lib/constants';
import { fmtNumber, fmtFCFA, fmtDate } from '@/lib/utils';

interface SiteStock {
  siteId: string;
  code: string;
  nom: string;
  region: string;
  stockLitres: number;
  /** Faux = aucun relevé connu : « - », jamais « 0 L ». */
  mesure: boolean;
  /** Date du dernier événement qui a bougé ce stock (relevé ou livraison). */
  dateStock: string | null;
  ageJours: number | null;
  /** Mesure trop ancienne pour décrire l'état d'aujourd'hui. */
  perimee: boolean;
  litresMois: number;
  coutMoisFCFA: number;
  autonomieJours: number | null;
  niveauAlerte: string;
  /** Saisies encore à vérifier sur ce site (contrôle de vraisemblance). */
  saisiesSignalees: { nb: number; codes: string[] } | null;
}

const ORDRE: Record<string, number> = { VIDE: 0, CRITIQUE: 1, FAIBLE: 2, OK: 3, NA: 4 };

export default function StockCarburantPage() {
  const [region, setRegion] = useState('');
  const [niveau, setNiveau] = useState('');
  // Compte prestataire (ma-societe non nul) : la chaîne d'approvisionnement
  // (bons de commande) est interne - le bouton ne doit pas apparaître.
  const { data: maSociete } = useQuery({
    queryKey: ['ma-societe'],
    queryFn: () => api.get('/ma-societe').then((r) => r.data.data as { nom: string } | null),
    staleTime: 10 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['stock', region],
    queryFn: () => api.get('/rapports/stock-carburant', { params: { region: region || undefined } }).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  const resume = data?.resume ?? {};
  let sites: SiteStock[] = data?.sites ?? [];
  if (niveau) sites = sites.filter((s) => s.niveauAlerte === niveau);
  sites = [...sites].sort((a, b) => (ORDRE[a.niveauAlerte] ?? 9) - (ORDRE[b.niveauAlerte] ?? 9) || a.stockLitres - b.stockLitres);

  const columns: Column<SiteStock>[] = [
    { key: 'code', header: 'Site', render: (s) => <span className="font-medium text-gray-800">{s.nom}</span> },
    { key: 'region', header: 'Région' },
    {
      key: 'stockLitres', header: 'Stock (L)', align: 'right',
      render: (s) => s.mesure
        ? fmtNumber(s.stockLitres)
        : <span className="text-gray-300" title="Aucun relevé de cuve sur ce site : le stock est inconnu, pas nul.">-</span>,
    },
    {
      // LA FRAÎCHEUR FAIT PARTIE DU CHIFFRE. Un niveau relevé il y a six mois
      // reste la dernière mesure connue, mais ce n'est pas l'état du jour -
      // et c'est pourtant sur lui que reposent l'autonomie et l'alerte.
      key: 'dateStock', header: 'Mesuré le', align: 'right',
      render: (s) => !s.dateStock
        ? <span className="text-gray-300">-</span>
        : (
          <span className={`whitespace-nowrap text-xs ${s.perimee ? 'font-semibold text-amber-700' : 'text-gray-500'}`}
            title={s.perimee ? 'Mesure trop ancienne : le stock affiché ne décrit plus l’état du jour.' : undefined}>
            {fmtDate(s.dateStock)}{s.ageJours != null && <span className="ml-1 text-gray-400">({s.ageJours} j)</span>}
          </span>
        ),
    },
    { key: 'autonomieJours', header: 'Autonomie', align: 'right', render: (s) => (s.autonomieJours != null ? `${s.autonomieJours} j` : '-') },
    // Théorique assumé : cette page lit la formule kVA (budget), pas la mesure.
    // La conso MESURÉE par site est sur « Réapprovisionnement » avec sa source.
    { key: 'litresMois', header: 'Conso/mois théorique (L)', align: 'right', render: (s) => fmtNumber(s.litresMois) },
    { key: 'coutMoisFCFA', header: 'Coût/mois', align: 'right', render: (s) => fmtFCFA(s.coutMoisFCFA) },
    { key: 'niveauAlerte', header: 'Niveau', align: 'center', render: (s) => <NiveauStockBadge value={s.niveauAlerte} /> },
    {
      // Ce stock DÉCOULE de la dernière jauge. Si c'est elle qui est signalée,
      // il faut le savoir avant d'envoyer un camion - ou de n'en envoyer aucun.
      key: 'saisies', header: 'Saisies', align: 'center',
      render: (s) => s.saisiesSignalees
        ? (
          <Link href={`/supervision/anomalies?site_id=${s.siteId}`}
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200"
            title={`${s.saisiesSignalees.nb} saisie(s) à vérifier sur ce site : le stock affiché en découle.`}>
            <AlertTriangle size={11} /> {s.saisiesSignalees.nb}
          </Link>
        )
        : <span className="text-gray-300">-</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Stock carburant"
        subtitle="Vue globale du parc et alertes d'autonomie"
        actions={
          <div className="flex gap-2">
            {!maSociete && <ButtonLink href="/carburant/commandes" variant="secondary" icon={Truck}>Approvisionnement</ButtonLink>}
            <ButtonLink href="/carburant/depotages" variant="secondary" icon={History}>Dépotages</ButtonLink>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Stock total" value={`${fmtNumber(Math.round((resume.totalLitres ?? 0) / 1000))}k L`}
          subtitle={resume.nbSites
            ? `${resume.nbSitesMesures ?? 0} / ${resume.nbSites} mesurés${resume.nbSitesPerimes ? ` · ${resume.nbSitesPerimes} périmés` : ''}`
            : undefined}
          icon={Fuel} color="bg-[rgb(var(--accent))]" />
        <StatCard title="Conso parc" value={`${fmtNumber(Math.round((resume.totalLitresMois ?? 0) / 1000))}k L/mois`} icon={Droplet} color="bg-[rgb(var(--brand-light))]" />
        {/* Coût masqué côté serveur pour les comptes prestataires : « - », pas « 0 M ». */}
        <StatCard title="Coût mensuel" value={resume.totalCoutMoisFCFA == null ? '-' : `${fmtNumber(Math.round(resume.totalCoutMoisFCFA / 1_000_000))} M`} subtitle="FCFA/mois" icon={Banknote} color="bg-[rgb(var(--brand))]" />
        <StatCard title="Sites en alerte" value={(resume.nbSitesVides ?? 0) + (resume.nbSitesCritiques ?? 0)}
          subtitle={resume.nbSitesSaisiesSignalees ? `${resume.nbSitesFaibles ?? 0} faibles · ${resume.nbSitesSaisiesSignalees} à saisies signalées` : `${resume.nbSitesFaibles ?? 0} faibles`}
          icon={AlertTriangle} color="bg-red-500" />
      </div>

      <FilterBar
        filters={[
          { key: 'region', label: 'Toutes régions', value: region, options: regionOptions, onChange: setRegion },
          { key: 'niveau', label: 'Tous niveaux', value: niveau, options: [
            { value: 'VIDE', label: 'Vide' }, { value: 'CRITIQUE', label: 'Critique' },
            { value: 'FAIBLE', label: 'Faible' }, { value: 'OK', label: 'OK' },
          ], onChange: setNiveau },
        ]}
      />

      {sites.length === 0 ? <EmptyState title="Aucun site" /> : <DataTable columns={columns} data={sites} maxHeight="65vh" rowKey={(s) => s.siteId} />}
    </div>
  );
}
