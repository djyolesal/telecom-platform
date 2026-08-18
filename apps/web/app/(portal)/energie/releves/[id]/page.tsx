'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
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

const SOURCE_COLOR: Record<string, string> = {
  CEET: 'bg-blue-100 text-blue-700',
  GE: 'bg-orange-100 text-orange-700',
  SOLAIRE: 'bg-green-100 text-green-700',
};

export default function ReleveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: r, isLoading, isError } = useQuery({
    queryKey: ['releve', id],
    queryFn: () => api.get(`/releves/${id}`).then((res) => res.data.data),
  });

  if (isLoading) return <Loading />;
  if (isError || !r) return <ErrorState message="Relevé introuvable" />;

  const m = r.maintenance;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Relevé énergie - ${r.site?.nom ?? ''}`}
        subtitle={fmtDateTime(r.dateReleve)}
        backHref="/energie/releves"
        actions={m ? <Button variant="secondary" icon={Wrench} onClick={() => router.push(`/maintenance/${m.id}`)}>Voir la maintenance</Button> : undefined}
      />

      <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-2xl">
        <Row label="Site" value={r.site?.nom ?? '—'} />
        <Row label="Date" value={fmtDateTime(r.dateReleve)} />
        {r.provenance && <Row label="Provenance" value={r.provenance} />}
        <Row label="Source" value={<Badge className={SOURCE_COLOR[r.source] || 'bg-gray-100 text-gray-600'}>{r.source}</Badge>} />
        {r.indexCompteur != null && <Row label="Index compteur" value={fmtNumber(Number(r.indexCompteur))} />}
        {r.consommationKwh != null && <Row label="Consommation" value={`${fmtNumber(Number(r.consommationKwh))} kWh`} />}
        {r.volumeGasoilLitres != null && <Row label="Niveau cuve" value={`${fmtNumber(Number(r.volumeGasoilLitres))} L`} />}
        {r.gasoilConsommeLitres != null && <Row label="Gasoil consommé" value={`${fmtNumber(Number(r.gasoilConsommeLitres))} L`} />}
        {r.heuresFonctGE != null && <Row label="Heures GE" value={`${fmtNumber(Number(r.heuresFonctGE))} h`} />}
        {r.groupe?.numero != null && <Row label="Groupe électrogène" value={`GE n°${r.groupe.numero}${r.groupe.puissanceKva != null ? ` · ${fmtNumber(Number(r.groupe.puissanceKva))} kVA` : ''}`} />}
        {r.puissanceKva != null && <Row label="Puissance solaire" value={`${fmtNumber(Number(r.puissanceKva))} kVA`} />}
        {r.coutEstime != null && <Row label="Coût estimé" value={fmtFCFA(Number(r.coutEstime))} />}
        <Row label="Technicien" value={r.technicien ? `${r.technicien.prenom} ${r.technicien.nom}` : '—'} />
        {r.observations && <Row label="Observations" value={r.observations} />}
      </div>

      {m && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-2xl">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Maintenance d’origine</h3>
          <Row label="Type" value={m.type} />
          <Row label="Catégorie" value={m.categorie} />
          <Row label="Équipement" value={m.equipement} />
          <Row label="Clôturée le" value={m.dateFin ? fmtDateTime(m.dateFin) : '—'} />
        </div>
      )}
    </div>
  );
}
