'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, PlayCircle, AlertTriangle, CheckCircle2, CircleSlash } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { StatCard } from '@/components/shared/StatCard';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { fmtDate } from '@/lib/utils';

interface Ligne {
  siteId: string;
  siteCode: string;
  siteNom: string;
  region: string;
  prestataire: string | null;
  tache: string;
  frequenceLabel: string;
  derniereExecution: string | null;
  prochaineEcheance: string | null;
  statut: 'JAMAIS' | 'EN_RETARD' | 'A_JOUR';
}

const STATUT_OPTIONS = [
  { value: 'EN_RETARD', label: 'En retard' },
  { value: 'JAMAIS', label: 'Jamais fait' },
  { value: 'A_JOUR', label: 'À jour' },
];

function StatutBadge({ value }: { value: Ligne['statut'] }) {
  const map = {
    EN_RETARD: 'bg-red-50 text-red-700 ring-red-100',
    JAMAIS: 'bg-orange-50 text-orange-700 ring-orange-100',
    A_JOUR: 'bg-green-50 text-green-700 ring-green-100',
  };
  const label = { EN_RETARD: 'En retard', JAMAIS: 'Jamais', A_JOUR: 'À jour' };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${map[value]}`}>{label[value]}</span>;
}

export default function EcheancierPreventifPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const canGenerate = role === 'MANAGER' || role === 'ADMIN';
  const [prestataireId, setPrestataireId] = useState('');
  const [statut, setStatut] = useState('');

  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });
  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  const { data, isLoading, isError } = useQuery({
    queryKey: ['echeancier', { prestataireId, statut }],
    queryFn: () =>
      api.get('/rapports/echeancier-preventif', { params: { prestataire_id: prestataireId || undefined, statut: statut || undefined } }).then((r) => r.data.data),
  });

  const generer = useMutation({
    mutationFn: () => api.post('/taches-preventives/generer').then((r) => r.data.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['echeancier'] }),
  });

  const resume = data?.resume ?? { aJour: 0, enRetard: 0, jamais: 0, total: 0 };
  const lignes: Ligne[] = data?.lignes ?? [];

  const columns: Column<Ligne>[] = [
    { key: 'siteNom', header: 'Site', render: (l) => <span className="font-medium text-gray-800">{l.siteNom}</span> },
    { key: 'region', header: 'Région' },
    { key: 'prestataire', header: 'Prestataire', render: (l) => l.prestataire ?? '—' },
    { key: 'tache', header: 'Tâche' },
    { key: 'frequenceLabel', header: 'Fréquence' },
    { key: 'derniereExecution', header: 'Dernière', render: (l) => (l.derniereExecution ? fmtDate(l.derniereExecution) : '—') },
    { key: 'prochaineEcheance', header: 'Échéance', render: (l) => (l.prochaineEcheance ? fmtDate(l.prochaineEcheance) : '—') },
    { key: 'statut', header: 'Statut', render: (l) => <StatutBadge value={l.statut} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Échéancier préventif contractuel"
        subtitle="Conformité des tâches préventives par site / prestataire"
        actions={
          canGenerate && (
            <Button icon={PlayCircle} loading={generer.isPending} onClick={() => generer.mutate()}>
              Générer le planning
            </Button>
          )
        }
      />

      {generer.isSuccess && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          <CheckCircle2 size={15} /> {generer.data.crees} maintenance(s) préventive(s) planifiée(s).
          {generer.data.ignoresSansPrestataire > 0 && ` ${generer.data.ignoresSansPrestataire} ignorée(s) (site sans prestataire passif).`}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total tâches" value={String(resume.total)} icon={CalendarClock} color="bg-[#1B3F6B]" />
        <StatCard title="En retard" value={String(resume.enRetard)} icon={AlertTriangle} color="bg-[#C0392B]" />
        <StatCard title="Jamais faites" value={String(resume.jamais)} icon={CircleSlash} color="bg-[#D68910]" />
        <StatCard title="À jour" value={String(resume.aJour)} icon={CheckCircle2} color="bg-[#0E7C6B]" />
      </div>

      <FilterBar
        filters={[
          { key: 'prestataire', label: 'Tous prestataires', value: prestataireId, options: prestataireOptions, onChange: setPrestataireId },
          { key: 'statut', label: 'Tous statuts', value: statut, options: STATUT_OPTIONS, onChange: setStatut },
        ]}
      />

      {isLoading ? (
        <TableSkeleton cols={8} />
      ) : isError ? (
        <ErrorState />
      ) : lignes.length === 0 ? (
        <EmptyState title="Aucune tâche" hint="Vérifiez les attributs des sites (pylône, cuve, GE…) et les rattachements aux lots." />
      ) : (
        <DataTable columns={columns} data={lignes} />
      )}
    </div>
  );
}
