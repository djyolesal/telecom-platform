'use client';

import { useState } from 'react';
import { L_STATUT_BL } from '@/lib/constants';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { Button } from '@/components/shared/Button';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { fmtNumber, fmtDate } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const BL_COLORS: Record<string, string> = { PLANIFIE: 'bg-amber-100 text-amber-700', CHARGE: 'bg-blue-100 text-blue-700', LIVRE: 'bg-green-100 text-green-700', ANNULE: 'bg-red-100 text-red-700' };

interface BL {
  id: string; numeroBL: string; mois: number; annee: number; immatriculation: string;
  volumeChargeLitres: number; dateChargement: string; statut: string;
  bonCommande?: { numero: string }; _count?: { lignes: number };
}

export default function BonsLivraisonPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  // L'export global des BL est réservé au pilotage (rbac MANAGER/ADMIN) : sans
  // ce test, le transporteur voyait un bouton qui ne pouvait que renvoyer 403.
  const { data: session } = useSession();
  const estTransporteur = (session?.user as { role?: string })?.role === 'TRANSPORTEUR';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bons-livraison', { page }],
    queryFn: () => api.get('/bons-livraison', { params: { page, limit: 20 } }).then((r) => r.data),
  });

  const rows: BL[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<BL>[] = [
    { key: 'numeroBL', header: 'N° BL', render: (b) => <span className="font-medium text-gray-800">{b.numeroBL}</span> },
    { key: 'bc', header: 'BC', render: (b) => b.bonCommande?.numero ?? '—' },
    { key: 'mois', header: 'Mois', render: (b) => `${MOIS[b.mois]} ${b.annee}` },
    { key: 'camion', header: 'Camion', render: (b) => b.immatriculation },
    { key: 'volume', header: 'Volume (L)', align: 'right', render: (b) => fmtNumber(Number(b.volumeChargeLitres)) },
    { key: 'sites', header: 'Sites', align: 'center', render: (b) => b._count?.lignes ?? 0 },
    { key: 'date', header: 'Chargement', render: (b) => fmtDate(b.dateChargement) },
    { key: 'statut', header: 'Statut', render: (b) => <Badge className={BL_COLORS[b.statut] || ''}>{L_STATUT_BL[b.statut] ?? b.statut}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        title={estTransporteur ? 'Mes chargements' : 'Bons de livraison carburant'}
        subtitle={estTransporteur
          ? 'Vos camions chargés et leur plan de livraison'
          : 'Chargements de camions et plans de livraison'}
        backHref={estTransporteur ? '/dashboard' : '/carburant/commandes'}
        actions={estTransporteur ? undefined : <ExportButtons base="/bons-livraison/export" name="bons-livraison" />}
      />

      {isLoading ? (
        <TableSkeleton cols={8} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun bon de livraison" hint="Les bons de livraison se créent depuis un bon de commande." />
      ) : (
        <>
          <DataTable columns={columns} data={rows} onRowClick={(b) => router.push(`/carburant/livraisons/${b.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}
