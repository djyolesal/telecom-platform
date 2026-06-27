'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { TableSkeleton, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { fmtNumber, fmtDate } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const BL_COLORS: Record<string, string> = { PLANIFIE: 'bg-amber-100 text-amber-700', CHARGE: 'bg-blue-100 text-blue-700', LIVRE: 'bg-green-100 text-green-700', ANNULE: 'bg-red-100 text-red-700' };
const LIGNE_COLORS: Record<string, string> = { PREVU: 'bg-gray-100 text-gray-600', PARTIEL: 'bg-amber-100 text-amber-700', LIVRE: 'bg-green-100 text-green-700', ANNULE: 'bg-red-100 text-red-700' };

interface Ligne {
  id: string; volumePrevuLitres: number; volumeLivreReel: number; ecart: number; statut: string;
  site: { code: string; nom: string; region: string };
  depotages: { id: string; dateDepotage: string; volumeLitres: number }[];
}
interface BL {
  id: string; numeroBL: string; mois: number; annee: number; immatriculation: string; numeroClient: string;
  volumeChargeLitres: number; dateChargement: string; dateTraitement?: string; statut: string; observations?: string;
  bonCommande?: { numero: string; annee: number; trimestre: number };
  lignes: Ligne[]; sommeLignes: number; coherenceCharge: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between py-1.5 text-sm border-b last:border-0"><span className="text-gray-500">{label}</span><span className="font-medium text-gray-800">{value}</span></div>;
}

export default function BonLivraisonDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bon-livraison', id],
    queryFn: () => api.get(`/bons-livraison/${id}`).then((r) => r.data.data as BL),
  });

  if (isLoading) return <div className="p-6"><TableSkeleton cols={4} /></div>;
  if (isError || !data) return <div className="p-6"><ErrorState /></div>;

  const totalLivreReel = data.lignes.reduce((s, l) => s + l.volumeLivreReel, 0);

  return (
    <div>
      <PageHeader
        title={`Bon de livraison ${data.numeroBL}`}
        subtitle={`${MOIS[data.mois]} ${data.annee} · BC ${data.bonCommande?.numero ?? ''} · Camion ${data.immatriculation}`}
        backHref={`/carburant/livraisons`}
        actions={<Badge className={BL_COLORS[data.statut] || ''}>{data.statut}</Badge>}
      />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-700 text-sm mb-2">Détails du chargement</h3>
          <Row label="N° client" value={data.numeroClient} />
          <Row label="Camion" value={data.immatriculation} />
          <Row label="Volume chargé" value={`${fmtNumber(Number(data.volumeChargeLitres))} L`} />
          <Row label="Date chargement" value={fmtDate(data.dateChargement)} />
          {data.dateTraitement && <Row label="Date traitement" value={fmtDate(data.dateTraitement)} />}
        </div>
        <div className={`rounded-xl border p-5 ${data.coherenceCharge ? 'border-green-100 bg-green-50/50' : 'border-amber-200 bg-amber-50/60'}`}>
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
            {data.coherenceCharge ? <CheckCircle2 size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-amber-600" />}
            Contrôle de cohérence
          </h3>
          <Row label="Total du plan (prévu)" value={`${fmtNumber(data.sommeLignes)} L`} />
          <Row label="Volume chargé camion" value={`${fmtNumber(Number(data.volumeChargeLitres))} L`} />
          <Row label="Total livré (réel)" value={`${fmtNumber(totalLivreReel)} L`} />
          <p className={`mt-2 text-sm font-medium ${data.coherenceCharge ? 'text-green-700' : 'text-amber-700'}`}>
            {data.coherenceCharge ? 'Plan cohérent : Σ sites = volume chargé.' : 'Incohérence : la somme des volumes prévus diffère du volume chargé.'}
          </p>
        </div>
      </div>

      {/* Plan de livraison : sites + prévu vs livré réel */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="font-semibold text-gray-700 text-sm mb-3">Plan de livraison ({data.lignes.length} sites)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs border-b">
              <th className="text-left py-2">Site</th>
              <th className="text-left">Région</th>
              <th className="text-right">Prévu (L)</th>
              <th className="text-right">Livré réel (L)</th>
              <th className="text-right">Écart</th>
              <th className="text-left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {data.lignes.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="py-2"><span className="font-medium text-gray-800">{l.site.code}</span> <span className="text-gray-500">{l.site.nom}</span></td>
                <td className="text-gray-600">{l.site.region}</td>
                <td className="text-right">{fmtNumber(Number(l.volumePrevuLitres))}</td>
                <td className="text-right">{l.volumeLivreReel > 0 ? fmtNumber(l.volumeLivreReel) : '—'}</td>
                <td className={`text-right font-medium ${Math.abs(l.ecart) <= 0.5 ? 'text-gray-400' : l.ecart > 0 ? 'text-blue-600' : 'text-amber-600'}`}>
                  {l.volumeLivreReel > 0 ? `${l.ecart > 0 ? '+' : ''}${fmtNumber(l.ecart)}` : '—'}
                </td>
                <td><Badge className={LIGNE_COLORS[l.statut] || ''}>{l.statut}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.observations && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mt-4">
          <h3 className="font-semibold text-gray-700 text-sm mb-1">Observations</h3>
          <p className="text-sm text-gray-600">{data.observations}</p>
        </div>
      )}
    </div>
  );
}
