'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Fuel, AlertTriangle, Droplet, Banknote, History, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { ButtonLink } from '@/components/shared/Button';
import { Loading, EmptyState } from '@/components/shared/states';
import { NiveauStockBadge } from '@/components/shared/Badge';
import { regionOptions } from '@/lib/constants';
import { fmtNumber, fmtFCFA } from '@/lib/utils';

interface SiteStock {
  siteId: string;
  code: string;
  nom: string;
  region: string;
  stockLitres: number;
  litresMois: number;
  coutMoisFCFA: number;
  autonomieJours: number | null;
  niveauAlerte: string;
}

const ORDRE: Record<string, number> = { VIDE: 0, CRITIQUE: 1, FAIBLE: 2, OK: 3, NA: 4 };

export default function StockCarburantPage() {
  const [region, setRegion] = useState('');
  const [niveau, setNiveau] = useState('');
  // Compte prestataire (ma-societe non nul) : la chaîne d'approvisionnement
  // (bons de commande) est interne — le bouton ne doit pas apparaître.
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
    { key: 'stockLitres', header: 'Stock (L)', align: 'right', render: (s) => fmtNumber(s.stockLitres) },
    { key: 'autonomieJours', header: 'Autonomie', align: 'right', render: (s) => (s.autonomieJours != null ? `${s.autonomieJours} j` : '—') },
    // Théorique assumé : cette page lit la formule kVA (budget), pas la mesure.
    // La conso MESURÉE par site est sur « Réapprovisionnement » avec sa source.
    { key: 'litresMois', header: 'Conso/mois théorique (L)', align: 'right', render: (s) => fmtNumber(s.litresMois) },
    { key: 'coutMoisFCFA', header: 'Coût/mois', align: 'right', render: (s) => fmtFCFA(s.coutMoisFCFA) },
    { key: 'niveauAlerte', header: 'Niveau', align: 'center', render: (s) => <NiveauStockBadge value={s.niveauAlerte} /> },
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
        <StatCard title="Stock total" value={`${fmtNumber(Math.round((resume.totalLitres ?? 0) / 1000))}k L`} icon={Fuel} color="bg-[#0E7C6B]" />
        <StatCard title="Conso parc" value={`${fmtNumber(Math.round((resume.totalLitresMois ?? 0) / 1000))}k L/mois`} icon={Droplet} color="bg-[#2471A3]" />
        {/* Coût masqué côté serveur pour les comptes prestataires : « — », pas « 0 M ». */}
        <StatCard title="Coût mensuel" value={resume.totalCoutMoisFCFA == null ? '—' : `${fmtNumber(Math.round(resume.totalCoutMoisFCFA / 1_000_000))} M`} subtitle="FCFA/mois" icon={Banknote} color="bg-[#1B3F6B]" />
        <StatCard title="Sites en alerte" value={(resume.nbSitesVides ?? 0) + (resume.nbSitesCritiques ?? 0)} subtitle={`${resume.nbSitesFaibles ?? 0} faibles`} icon={AlertTriangle} color="bg-red-500" />
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
