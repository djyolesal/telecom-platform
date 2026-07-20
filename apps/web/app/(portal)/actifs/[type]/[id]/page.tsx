'use client';

import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Loading, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { fmtDateTime } from '@/lib/utils';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800 text-right">{value ?? '—'}</span>
    </div>
  );
}

const STATUT_COLOR: Record<string, string> = {
  EN_SERVICE: 'bg-green-100 text-green-700', EN_STOCK: 'bg-gray-100 text-gray-600',
  EN_TRANSIT: 'bg-amber-100 text-amber-700', REFORME: 'bg-red-100 text-red-700',
};
const STATUT_LABEL: Record<string, string> = {
  EN_SERVICE: 'En service', EN_STOCK: 'Au dépôt', EN_TRANSIT: 'En transit', REFORME: 'Réformé',
};
const NATURE_LABEL: Record<string, string> = {
  INSTALLATION: 'Installation', DESINSTALLATION: 'Désinstallation', DEPLACEMENT: 'Déplacement',
};
const NATURE_COLOR: Record<string, string> = {
  INSTALLATION: 'bg-green-100 text-green-700', DESINSTALLATION: 'bg-gray-100 text-gray-600', DEPLACEMENT: 'bg-blue-100 text-blue-700',
};

interface Mouvement {
  id: string; natureTravaux: string; statut: string; datePlanifiee: string; dateFin: string | null;
  site: { code: string; nom: string } | null;
  siteSource: { code: string; nom: string } | null;
  technicien: { nom: string; prenom: string } | null;
}

export default function ActifDetailPage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string })?.role === 'ADMIN';

  const { data: a, isLoading, isError } = useQuery({
    queryKey: ['actif', type, id],
    queryFn: () => api.get(`/actifs/${type}/${id}`).then((r) => r.data.data),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/actifs/${type}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actifs'] });
      router.push('/actifs');
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast(e.response?.data?.error || 'Suppression impossible', 'error'),
  });

  if (isLoading) return <Loading />;
  if (isError || !a) return <ErrorState message="Actif introuvable" />;

  const historique: Mouvement[] = a.historique ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={a.libelle ?? a.categorie}
        subtitle={a.numeroSerie ? `N° série ${a.numeroSerie}` : a.categorie}
        backHref="/actifs"
        actions={isAdmin ? (
          <Button
            variant="secondary"
            icon={Trash2}
            loading={remove.isPending}
            onClick={() => {
              if (confirm('Supprimer définitivement cet actif du parc ?\nRefusé s\'il est posé sur un site ou porte un historique.')) remove.mutate();
            }}
          >
            Supprimer
          </Button>
        ) : undefined}
      />

      <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-2xl">
        <Row label="Type" value={a.categorie} />
        <Row label="N° série" value={a.numeroSerie} />
        <Row label="Caractéristique" value={a.caracteristique} />
        <Row label="Statut" value={<Badge className={STATUT_COLOR[a.statutActif] || 'bg-gray-100 text-gray-600'}>{STATUT_LABEL[a.statutActif] ?? a.statutActif}</Badge>} />
        <Row label="Emplacement" value={a.site?.nom ?? 'Dépôt'} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 max-w-2xl">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Historique des mouvements ({historique.length})</h3>
        {historique.length === 0 ? (
          <p className="text-sm text-gray-400">Aucun mouvement enregistré.</p>
        ) : (
          <div className="space-y-3">
            {historique.map((m) => (
              <div key={m.id} className="flex items-start gap-3 border-b border-gray-50 last:border-0 pb-3 last:pb-0">
                <Badge className={NATURE_COLOR[m.natureTravaux] || 'bg-gray-100 text-gray-600'}>{NATURE_LABEL[m.natureTravaux] ?? m.natureTravaux}</Badge>
                <div className="text-sm">
                  <p className="text-gray-800">
                    {m.natureTravaux === 'DEPLACEMENT' && m.siteSource
                      ? `${m.siteSource.nom} → ${m.site?.nom ?? '—'}`
                      : m.natureTravaux === 'DESINSTALLATION'
                        ? `Déposé de ${m.site?.nom ?? '—'}`
                        : `Posé sur ${m.site?.nom ?? '—'}`}
                  </p>
                  <p className="text-xs text-gray-400">
                    {m.statut === 'TERMINEE' ? fmtDateTime(m.dateFin) : `Planifié — ${fmtDateTime(m.datePlanifiee)}`}
                    {m.technicien ? ` · ${m.technicien.prenom} ${m.technicien.nom}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
