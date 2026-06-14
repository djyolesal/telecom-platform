'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Fuel, Zap, Gauge } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { DataTable } from '@/components/shared/DataTable';
import { NiveauStockBadge, StatutMaintBadge, StatutIncidentBadge } from '@/components/shared/Badge';
import { POWER_CONFIGS, STATUTS_GE } from '@/lib/constants';
import { fmtDateTime, fmtNumber } from '@/lib/utils';

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: site, isLoading, isError } = useQuery({
    queryKey: ['site', id],
    queryFn: () => api.get(`/sites/${id}`).then((r) => r.data.data),
  });
  const { data: stock } = useQuery({
    queryKey: ['site-stock', id],
    queryFn: () => api.get(`/sites/${id}/stock`).then((r) => r.data.data),
    enabled: !!site,
  });
  const { data: maint } = useQuery({
    queryKey: ['site-maint', id],
    queryFn: () => api.get(`/sites/${id}/maintenances`, { params: { limit: 5 } }).then((r) => r.data.data),
    enabled: !!site,
  });
  const { data: incidents } = useQuery({
    queryKey: ['site-incidents', id],
    queryFn: () => api.get(`/sites/${id}/incidents`, { params: { limit: 5 } }).then((r) => r.data.data),
    enabled: !!site,
  });

  if (isLoading) return <Loading />;
  if (isError || !site) return <ErrorState message="Site introuvable" />;

  return (
    <div>
      <PageHeader
        title={`${site.code} — ${site.nom}`}
        subtitle={`${site.region}${site.ville ? ' · ' + site.ville : ''}`}
        backHref="/sites"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Config énergie" value={POWER_CONFIGS.find((p) => p.value === site.powerConfig)?.label ?? site.powerConfig} icon={Zap} color="bg-[#2471A3]" />
        <StatCard title="Statut GE" value={STATUTS_GE.find((p) => p.value === site.statutGE)?.label ?? site.statutGE} icon={Gauge} color="bg-[#1B3F6B]" />
        <StatCard title="Stock gasoil" value={`${fmtNumber(stock?.stockLitres)} L`} subtitle={stock?.autonomieJours != null ? `Autonomie ${stock.autonomieJours} j` : undefined} icon={Fuel} color="bg-[#0E7C6B]" />
        <StatCard title="Puissance GE" value={`${Number(site.puissanceGEkva).toFixed(0)} kVA`} icon={MapPin} color="bg-[#1B3F6B]" />
      </div>

      {stock && stock.niveauAlerte !== 'NA' && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-4 text-sm">
          <span className="text-gray-600">Niveau d&apos;alerte stock :</span>
          <NiveauStockBadge value={stock.niveauAlerte} />
          <span className="text-gray-400">·</span>
          <span className="text-gray-600">Conso estimée : <b>{fmtNumber(stock.litresMois)} L/mois</b></span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-600">{fmtNumber(stock.coutMoisFCFA)} FCFA/mois</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section>
          <h3 className="font-semibold text-gray-700 text-sm mb-3">Maintenances récentes</h3>
          {!maint?.length ? (
            <EmptyState title="Aucune maintenance" />
          ) : (
            <DataTable<{ statut: string; datePlanifiee: string }>
              columns={[
                { key: 'equipement', header: 'Équipement' },
                { key: 'type', header: 'Type' },
                { key: 'statut', header: 'Statut', render: (m) => <StatutMaintBadge value={m.statut} /> },
                { key: 'datePlanifiee', header: 'Date', render: (m) => fmtDateTime(m.datePlanifiee) },
              ]}
              data={maint}
            />
          )}
        </section>

        <section>
          <h3 className="font-semibold text-gray-700 text-sm mb-3">Incidents récents</h3>
          {!incidents?.length ? (
            <EmptyState title="Aucun incident" />
          ) : (
            <DataTable<{ statut: string; dateOuverture: string }>
              columns={[
                { key: 'type', header: 'Type' },
                { key: 'severite', header: 'Sévérité' },
                { key: 'statut', header: 'Statut', render: (i) => <StatutIncidentBadge value={i.statut} /> },
                { key: 'dateOuverture', header: 'Ouverture', render: (i) => fmtDateTime(i.dateOuverture) },
              ]}
              data={incidents}
            />
          )}
        </section>
      </div>
    </div>
  );
}
