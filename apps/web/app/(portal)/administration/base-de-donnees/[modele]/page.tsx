'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Lock, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage, toast } from '@/lib/toast';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { Loading, TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { EnregistrementModal } from '../EnregistrementModal';
import { PanneauLigne } from '../PanneauLigne';
import { Ligne, Relations, TableMeta, afficher, champsAffichables } from '../types';

/** Colonnes visibles d'emblée ; au-delà, le sélecteur « Colonnes » les réactive. */
const COLONNES_VISIBLES = 8;

/**
 * Console base de données — exploration et édition d'une table.
 *
 * Recherche, filtres, tri et pagination sont faits PAR L'API (et non sur la
 * page courante) : sur une table de plusieurs milliers de lignes, un tri limité
 * aux 25 lignes affichées donnerait un résultat faux.
 */
export default function TablePage() {
  const { modele } = useParams<{ modele: string }>();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [q, setQ] = useState('');
  const [tri, setTri] = useState('');
  const [sens, setSens] = useState<'asc' | 'desc'>('desc');
  const [filtres, setFiltres] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<Ligne | null>(null);
  const [formulaire, setFormulaire] = useState<{ ligne: Ligne | null } | null>(null);

  const { data: meta, isLoading: chargeMeta, isError: erreurMeta } = useQuery({
    queryKey: ['db-meta', modele],
    queryFn: () => api.get(`/admin/db/tables/${modele}`).then((r) => r.data.data as TableMeta),
  });

  const params = useMemo(() => {
    const p: Record<string, string | number> = { page, limit, sens };
    if (q.trim()) p.q = q.trim();
    if (tri) p.tri = tri;
    for (const [champ, valeur] of Object.entries(filtres)) if (valeur) p[`f_${champ}`] = valeur;
    return p;
  }, [page, limit, q, tri, sens, filtres]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['db-lignes', modele, params],
    queryFn: () => api.get(`/admin/db/tables/${modele}/lignes`, { params }).then((r) => r.data),
    enabled: !!meta,
    placeholderData: (prec) => prec,
  });

  const lignes: Ligne[] = data?.data ?? [];
  const relations: Relations | undefined = data?.relations;
  const pagination: PaginationMeta | undefined = data?.meta;

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['db-lignes', modele] });
    queryClient.invalidateQueries({ queryKey: ['db-catalogue'] });
  };

  const supprimer = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/db/tables/${modele}/lignes/${id}`),
    onSuccess: () => { toast('Enregistrement supprimé', 'success'); setSelection(null); rafraichir(); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const colonnes: Column<Ligne>[] = useMemo(() => {
    if (!meta) return [];
    return champsAffichables(meta).map((c, i) => ({
      key: c.nom,
      header: c.nom,
      // Le tri est fait par l'API sur la table entière : un tri local sur la
      // page affichée donnerait un ordre différent selon la page.
      sortable: false,
      defaultHidden: i >= COLONNES_VISIBLES,
      render: (ligne: Ligne) => (
        <span className={`block max-w-[260px] truncate ${c.estId || c.fkVers ? 'font-mono text-xs text-gray-500' : ''}`}>
          {afficher(c, ligne[c.nom], relations)}
        </span>
      ),
    }));
  }, [meta, relations]);

  if (chargeMeta) return <Loading />;
  if (erreurMeta || !meta) return <ErrorState message="Table introuvable" />;

  const champsFiltrables = meta.champs.filter((c) => (c.kind === 'enum' || c.type === 'Boolean') && !c.secret);
  const champsTriables = meta.champs.filter((c) => c.kind !== 'relation' && !c.secret);
  const requete = new URLSearchParams(
    Object.entries(params).filter(([k]) => k !== 'page' && k !== 'limit').map(([k, v]) => [k, String(v)])
  ).toString();

  return (
    <div>
      <PageHeader
        title={meta.libelle}
        subtitle={`Table ${meta.table} · ${meta.champs.filter((c) => c.kind !== 'relation').length} colonnes${meta.lectureSeule ? ' · consultation seule' : ''}`}
        backHref="/administration/base-de-donnees"
        actions={
          <>
            <ExportButtons base={`/admin/db/tables/${meta.modele}/export`} name={`base-${meta.table}`} query={requete} />
            {!meta.lectureSeule && (
              <Button icon={Plus} onClick={() => setFormulaire({ ligne: null })}>Nouveau</Button>
            )}
          </>
        }
      />

      {meta.lectureSeule && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <Lock size={15} /> Cette table est une preuve : elle se consulte et s&apos;exporte, mais ne se modifie pas depuis la console.
        </div>
      )}

      <FilterBar
        search={q}
        onSearch={(v) => { setQ(v); setPage(1); }}
        searchPlaceholder="Rechercher dans les colonnes texte…"
        filters={champsFiltrables.map((c) => ({
          key: c.nom,
          label: c.nom,
          value: filtres[c.nom] ?? '',
          options:
            c.type === 'Boolean'
              ? [{ value: 'true', label: 'Oui' }, { value: 'false', label: 'Non' }]
              : (meta.enums[c.type] ?? []).map((v) => ({ value: v, label: v })),
          onChange: (v: string) => { setFiltres((f) => ({ ...f, [c.nom]: v })); setPage(1); },
        }))}
      >
        <select
          value={tri}
          onChange={(e) => { setTri(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2471A3]"
          title="Trier par"
        >
          <option value="">Tri par défaut</option>
          {champsTriables.map((c) => <option key={c.nom} value={c.nom}>Trier : {c.nom}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setSens((s) => (s === 'asc' ? 'desc' : 'asc'))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          title={sens === 'asc' ? 'Ordre croissant' : 'Ordre décroissant'}
        >
          {sens === 'asc' ? <ArrowUpNarrowWide size={15} /> : <ArrowDownWideNarrow size={15} />}
          {sens === 'asc' ? 'Croissant' : 'Décroissant'}
        </button>
        <select
          value={limit}
          onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2471A3]"
          title="Lignes par page"
        >
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </FilterBar>

      {isLoading && !data ? (
        <TableSkeleton cols={6} />
      ) : isError ? (
        <ErrorState message="Lecture de la table impossible" />
      ) : lignes.length === 0 ? (
        <EmptyState title="Aucune ligne" hint={q || Object.values(filtres).some(Boolean) ? 'Aucun résultat pour ces critères.' : 'Cette table est vide.'} />
      ) : (
        <>
          <DataTable
            columns={colonnes}
            data={lignes}
            rowKey={(l) => String(l[meta.idChamp])}
            onRowClick={(l) => setSelection(l)}
            maxHeight="65vh"
          />
          <Pagination meta={pagination} onChange={setPage} />
        </>
      )}

      {selection && (
        <PanneauLigne
          meta={meta}
          ligne={selection}
          relations={relations}
          onClose={() => setSelection(null)}
          onModifier={() => setFormulaire({ ligne: selection })}
          onSupprimer={() => supprimer.mutate(String(selection[meta.idChamp]))}
          suppressionEnCours={supprimer.isPending}
        />
      )}

      {formulaire && (
        <EnregistrementModal
          meta={meta}
          ligne={formulaire.ligne}
          relations={relations}
          onClose={() => setFormulaire(null)}
          onEnregistre={() => { setSelection(null); rafraichir(); }}
        />
      )}
    </div>
  );
}
