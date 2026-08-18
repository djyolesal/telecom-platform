'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Fuel, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, EmptyState } from '@/components/shared/states';
import { NiveauStockBadge, SeveriteBadge } from '@/components/shared/Badge';
import { useSupervisionSocket } from '@/lib/hooks/useSupervisionSocket';
import { fmtNumber, fmtDateTime } from '@/lib/utils';

export default function AlertesPage() {
  const router = useRouter();
  useSupervisionSocket();

  const { data: stockData, isLoading: l1 } = useQuery({
    queryKey: ['stock'],
    queryFn: () => api.get('/rapports/stock-carburant').then((r) => r.data.data),
    refetchInterval: 60_000,
    // staleTime aligné : sans lui, chaque tick refait un aller-retour réseau
    // même si la donnée vient d'arriver (endpoints agrégés coûteux).
    staleTime: 60_000,
  });
  const { data: incData, isLoading: l2 } = useQuery({
    queryKey: ['incidents', { alertes: true }],
    queryFn: () => api.get('/incidents', { params: { severite: 'CRITIQUE', statut: 'OUVERT', limit: 50 } }).then((r) => r.data),
    refetchInterval: 30_000,
    // staleTime aligné : sans lui, chaque tick refait un aller-retour réseau
    // même si la donnée vient d'arriver (endpoints agrégés coûteux).
    staleTime: 30_000,
  });

  const sitesAlerte = (stockData?.sites ?? []).filter((s: { niveauAlerte: string }) => ['VIDE', 'CRITIQUE'].includes(s.niveauAlerte));
  const incidents = incData?.data ?? [];

  return (
    <div>
      <PageHeader title="Centre d'alertes" subtitle="Stock critique & incidents critiques ouverts" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section>
          <h3 className="flex items-center gap-2 font-semibold text-gray-700 text-sm mb-3">
            <Fuel size={16} className="text-orange-500" /> Alertes carburant ({sitesAlerte.length})
          </h3>
          {l1 ? <Loading /> : sitesAlerte.length === 0 ? (
            <EmptyState title="Aucune alerte carburant" />
          ) : (
            <div className="space-y-2">
              {sitesAlerte.map((s: { siteId: string; code: string; nom: string; region: string; stockLitres: number; autonomieJours: number | null; niveauAlerte: string }) => (
                <button key={s.siteId} onClick={() => router.push(`/sites/${s.siteId}`)} className="w-full text-left bg-white rounded-xl border border-gray-100 p-3 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800 text-sm">{s.nom}</span>
                    <NiveauStockBadge value={s.niveauAlerte} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.region} · {fmtNumber(s.stockLitres)} L {s.autonomieJours != null && `· autonomie ${s.autonomieJours} j`}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="flex items-center gap-2 font-semibold text-gray-700 text-sm mb-3">
            <AlertTriangle size={16} className="text-red-500" /> Incidents critiques ouverts ({incidents.length})
          </h3>
          {l2 ? <Loading /> : incidents.length === 0 ? (
            <EmptyState title="Aucun incident critique" />
          ) : (
            <div className="space-y-2">
              {incidents.map((i: { id: string; type: string; severite: string; description: string; dateOuverture: string; site?: { code: string; nom: string } }) => (
                <button key={i.id} onClick={() => router.push(`/incidents/${i.id}`)} className="w-full text-left bg-white rounded-xl border border-gray-100 p-3 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800 text-sm">{i.site?.nom} - {i.type}</span>
                    <SeveriteBadge value={i.severite} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{i.description}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{fmtDateTime(i.dateOuverture)}</p>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
