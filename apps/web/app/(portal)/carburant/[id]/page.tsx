'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState } from '@/components/shared/states';
import { fmtNumber, fmtFCFA, fmtDateTime } from '@/lib/utils';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800 text-right">{value ?? '—'}</span>
    </div>
  );
}

export default function DepotageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: d, isLoading, isError } = useQuery({
    queryKey: ['depotage', id],
    queryFn: () => api.get(`/depotages/${id}`).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  if (isError || !d) return <ErrorState message="Dépotage introuvable" />;

  return (
    <div>
      <PageHeader title={`Dépotage — ${d.site?.code ?? ''}`} subtitle={fmtDateTime(d.dateDepotage)} backHref="/carburant/depotages" />
      <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-2xl">
        <Row label="Site" value={d.site ? `${d.site.code} — ${d.site.nom}` : '—'} />
        <Row label="Date" value={fmtDateTime(d.dateDepotage)} />
        <Row label="Volume livré" value={`${fmtNumber(Number(d.volumeLitres))} L`} />
        <Row label="Stock avant" value={d.stockAvantLitres != null ? `${fmtNumber(Number(d.stockAvantLitres))} L` : '—'} />
        <Row label="Stock après" value={d.stockApresLitres != null ? `${fmtNumber(Number(d.stockApresLitres))} L` : '—'} />
        <Row label="Fournisseur" value={d.fournisseur} />
        <Row label="Bon de livraison" value={d.numeroBonLivraison} />
        <Row label="Prix / litre" value={d.prixLitre != null ? fmtFCFA(Number(d.prixLitre)) : '—'} />
        <Row label="Coût total" value={d.coutTotal != null ? fmtFCFA(Number(d.coutTotal)) : '—'} />
        <Row label="Technicien" value={d.technicien ? `${d.technicien.prenom} ${d.technicien.nom}` : '—'} />
        {d.observations && <Row label="Observations" value={d.observations} />}
      </div>
    </div>
  );
}
