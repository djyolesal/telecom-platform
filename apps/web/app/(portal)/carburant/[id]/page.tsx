'use client';

import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Loading, ErrorState } from '@/components/shared/states';
import { fmtNumber, fmtDateTime } from '@/lib/utils';
import { SignatureBlock } from '@/components/shared/SignatureBlock';
import { PhotoGallery } from '@/components/shared/PhotoGallery';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800 text-right">{value ?? '-'}</span>
    </div>
  );
}

/** Écart signé avec code couleur (vert ≈ 0, rouge négatif/manquant, ambre surplus). */
function EcartRow({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return <Row label={label} value="-" />;
  const v = Number(value);
  const color = Math.abs(v) < 1 ? 'text-emerald-600' : v < 0 ? 'text-red-600' : 'text-amber-600';
  const signe = v > 0 ? '+' : '';
  return <Row label={label} value={<span className={color}>{`${signe}${fmtNumber(v)} L`}</span>} />;
}

interface HeureGE {
  id: string;
  indexHeuresGE: number;
  groupe?: { numero: number; puissanceKva: number; statut: string };
}
interface Photo { id: string; url: string }

export default function DepotageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string })?.role === 'ADMIN';

  const { data: d, isLoading, isError } = useQuery({
    queryKey: ['depotage', id],
    queryFn: () => api.get(`/depotages/${id}`).then((r) => r.data.data),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/depotages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['depotages'] });
      router.push('/carburant/depotages');
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast(e.response?.data?.error || 'Suppression impossible', 'error'),
  });

  if (isLoading) return <Loading />;
  if (isError || !d) return <ErrorState message="Dépotage introuvable" />;

  const heures: HeureGE[] = d.heuresGE ?? [];
  const photos: Photo[] = d.photos ?? [];
  const hasRecon = d.volumeAnnonceLitres != null || d.ecartLivraisonLitres != null || d.ecartConsoLitres != null || d.analyseDepotage;

  const onDelete = () => {
    if (confirm(`Supprimer définitivement ce dépotage (${fmtNumber(Number(d.volumeLitres))} L, ${fmtDateTime(d.dateDepotage)}) ?\nLe stock du site et la livraison planifiée seront recalculés.`)) {
      remove.mutate();
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${d.reference ?? 'Dépotage'} - ${d.site?.nom ?? ''}`}
        subtitle={fmtDateTime(d.dateDepotage)}
        backHref="/carburant/depotages"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" icon={FileText} onClick={() => downloadFile(`/depotages/${id}/bordereau.pdf`, `bordereau-depotage-${id.slice(0, 8)}.pdf`)}>Bordereau PDF</Button>
            {isAdmin && <Button variant="secondary" icon={Trash2} onClick={onDelete} loading={remove.isPending}>Supprimer</Button>}
          </div>
        }
      />

      <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-2xl">
        <Row label="Site" value={d.site?.nom ?? '-'} />
        <Row label="Date" value={fmtDateTime(d.dateDepotage)} />
        <Row label="Volume livré (jauge)" value={`${fmtNumber(Number(d.volumeLitres))} L`} />
        <Row label="Stock avant" value={d.stockAvantLitres != null ? `${fmtNumber(Number(d.stockAvantLitres))} L${d.hauteurAvantCm != null ? ` (${Number(d.hauteurAvantCm)} cm mesurés)` : ''}` : '-'} />
        <Row label="Stock après" value={d.stockApresLitres != null ? `${fmtNumber(Number(d.stockApresLitres))} L${d.hauteurApresCm != null ? ` (${Number(d.hauteurApresCm)} cm mesurés)` : ''}` : '-'} />
        <Row label="Fournisseur" value={d.fournisseur} />
        <Row label="Bon de livraison" value={d.numeroBonLivraison} />
        <Row label="Technicien" value={d.technicien ? `${d.technicien.prenom} ${d.technicien.nom}` : '-'} />
        {d.observations && <Row label="Observations" value={d.observations} />}
      </div>

      {hasRecon && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-2xl">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Réconciliation carburant</h3>
          <Row label="Volume annoncé (BL)" value={d.volumeAnnonceLitres != null ? `${fmtNumber(Number(d.volumeAnnonceLitres))} L` : '-'} />
          <EcartRow label="Écart livraison (jauge − annoncé)" value={d.ecartLivraisonLitres} />
          <Row label="Gasoil attendu (depuis dernier dépotage)" value={d.gasoilAttenduLitres != null ? `${fmtNumber(Number(d.gasoilAttenduLitres))} L` : '-'} />
          <EcartRow label="Écart conso (réel − attendu)" value={d.ecartConsoLitres} />
          {d.analyseDepotage && (
            <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-line">{d.analyseDepotage}</div>
          )}
        </div>
      )}

      {heures.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-2xl">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Relevé heures groupes électrogènes</h3>
          {heures.map((h) => (
            <Row
              key={h.id}
              label={h.groupe ? `GE n°${h.groupe.numero} · ${fmtNumber(Number(h.groupe.puissanceKva))} kVA · ${h.groupe.statut === 'GE_PERMANENT' ? 'permanent' : 'secours'}` : 'GE'}
              value={`${fmtNumber(Number(h.indexHeuresGE))} h`}
            />
          ))}
        </div>
      )}

      {/* Visionneuse commune (zoom jusqu'à ×6, rotation, téléchargement) : une
          jauge ou un compteur photographié doit pouvoir se lire en détail. */}
      {photos.length > 0 && (
        <div className="max-w-2xl">
          <PhotoGallery photos={photos} title="Photos du dépotage" grandesVignettes />
        </div>
      )}

      <div className="max-w-2xl">
        <SignatureBlock signatures={d.signatures} />
      </div>

    </div>
  );
}
