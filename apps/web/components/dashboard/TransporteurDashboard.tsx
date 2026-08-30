'use client';

import { useRouter } from 'next/navigation';
import { L_STATUT_BL } from '@/lib/constants';
import { useQuery } from '@tanstack/react-query';
import { Truck, Droplets, PackageCheck, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Badge } from '@/components/shared/Badge';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { fmtNumber, fmtDate } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const STATUT_COULEURS: Record<string, string> = {
  PLANIFIE: 'bg-amber-100 text-amber-700',
  CHARGE: 'bg-blue-100 text-blue-700',
  LIVRE: 'bg-green-100 text-green-700',
  ANNULE: 'bg-red-100 text-red-700',
};

interface BL {
  id: string;
  numeroBL: string;
  mois: number;
  annee: number;
  immatriculation: string;
  volumeChargeLitres: number;
  dateChargement: string;
  statut: string;
  isBrouillon?: boolean;
  bonCommande?: { numero: string };
  _count?: { lignes: number };
}

/**
 * Tableau de bord du TRANSPORTEUR.
 *
 * Il n'a accès qu'à l'appro carburant : les endpoints agrégés du parc
 * (/rapports/dashboard) lui sont fermés côté API. Ce tableau de bord se
 * construit donc uniquement à partir de SES chargements (/bons-livraison, déjà
 * filtré sur son prestataire par le serveur) - aucune donnée d'un confrère ni
 * du parc n'y transite.
 */
export function TransporteurDashboard() {
  const router = useRouter();

  const { data: bls, isLoading, isError } = useQuery({
    queryKey: ['mes-bons-livraison'],
    queryFn: () => api.get('/bons-livraison', { params: { limit: 100 } }).then((r) => r.data.data as BL[]),
    staleTime: 60_000,
  });

  if (isLoading) return <TableSkeleton cols={6} />;
  if (isError || !bls) return <ErrorState message="Vos chargements sont indisponibles" />;

  // Les brouillons (générés par le réappro prédictif) ne sont pas des
  // chargements réels : ils ne comptent ni en volume ni en nombre.
  const reels = bls.filter((b) => !b.isBrouillon && b.statut !== 'ANNULE');
  const maintenant = new Date();
  const duMois = reels.filter((b) => b.mois === maintenant.getMonth() + 1 && b.annee === maintenant.getFullYear());
  const enCours = reels.filter((b) => b.statut === 'PLANIFIE' || b.statut === 'CHARGE');
  const volumeMois = duMois.reduce((s, b) => s + Number(b.volumeChargeLitres || 0), 0);
  const livres = reels.filter((b) => b.statut === 'LIVRE').length;
  const sansPlan = enCours.filter((b) => (b._count?.lignes ?? 0) === 0).length;

  const recents = [...reels]
    .sort((a, b) => new Date(b.dateChargement).getTime() - new Date(a.dateChargement).getTime())
    .slice(0, 8);

  return (
    <div>
      <PageHeader
        title="Mes chargements"
        subtitle="Appro carburant - vos bons de livraison et leur avancement"
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard title="Chargements du mois" value={duMois.length}
          subtitle={MOIS[maintenant.getMonth() + 1]} icon={Truck} color="bg-[#1B3F6B]" />
        <StatCard title="Volume du mois" value={`${fmtNumber(volumeMois)} L`}
          subtitle="chargé au dépôt" icon={Droplets} color="bg-[#0E7C6B]" />
        <StatCard title="En cours" value={enCours.length}
          subtitle={sansPlan > 0 ? `${sansPlan} sans plan défini` : 'plans définis'} icon={Clock} color="bg-[#E67E22]" />
        <StatCard title="Terminés" value={livres}
          subtitle="entièrement livrés" icon={PackageCheck} color="bg-[#2471A3]" />
      </div>

      {sansPlan > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>{sansPlan} chargement(s) sans plan de livraison.</b> Le manager doit répartir le volume
          entre les sites avant que vous puissiez livrer.
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700">Derniers chargements</h3>
        </div>
        {recents.length === 0 ? (
          <EmptyState title="Aucun chargement" hint="Vos bons de livraison apparaîtront ici." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2 font-medium">N° BL</th>
                  <th className="px-4 py-2 font-medium">Camion</th>
                  <th className="px-4 py-2 font-medium">Période</th>
                  <th className="px-4 py-2 text-right font-medium">Volume</th>
                  <th className="px-4 py-2 text-right font-medium">Sites</th>
                  <th className="px-4 py-2 font-medium">Chargement</th>
                  <th className="px-4 py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {recents.map((b) => (
                  <tr key={b.id}
                    onClick={() => router.push(`/carburant/livraisons/${b.id}`)}
                    className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">{b.numeroBL}</td>
                    <td className="px-4 py-2 text-gray-600">{b.immatriculation}</td>
                    <td className="px-4 py-2 text-gray-600">{MOIS[b.mois]} {b.annee}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtNumber(Number(b.volumeChargeLitres))} L</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {b._count?.lignes
                        ? b._count.lignes
                        : <span className="text-xs text-amber-600">à définir</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{fmtDate(b.dateChargement)}</td>
                    <td className="px-4 py-2">
                      <Badge className={STATUT_COULEURS[b.statut] ?? 'bg-gray-100 text-gray-600'}>{L_STATUT_BL[b.statut] ?? b.statut}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
