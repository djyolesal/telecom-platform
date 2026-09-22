'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { SOURCES_ENERGIE } from '@/lib/constants';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { useFiltresUrl } from '@/lib/hooks/useFiltresUrl';
import { fmtNumber, fmtDate } from '@/lib/utils';

interface Releve {
  id: string;
  siteId: string;
  dateReleve: string;
  source: string;
  provenance?: string;
  indexCompteur?: number | null;
  consommationKwh?: number | null;
  volumeGasoilLitres?: number | null;
  gasoilConsommeLitres?: number | null;
  indexHeuresGE?: number | null;
  heuresFonctGE?: number | null;
  puissanceKva?: number | null;
  site?: { code: string; nom: string };
  technicien?: { nom: string; prenom: string } | null;
  maintenance?: { id: string } | null;
  groupe?: { numero: number } | null;
}

/** Un PASSAGE = les relevés d'une même intervention fusionnés en une ligne
 *  (avant : une ligne par source, criblée de tirets). */
interface Passage {
  id: string;
  siteNom: string;
  dateReleve: string;
  provenance?: string;
  technicien?: string;
  indexCompteur?: number | null;
  consommationKwh?: number | null;
  jaugeLitres?: number | null;
  gasoilConsommeLitres?: number | null;
  ges: { numero: number | null; index: number | null; marche: number | null }[];
  puissanceKva?: number | null;
}

const PROVENANCE_COLOR: Record<string, string> = {
  Dépotage: 'bg-orange-100 text-orange-700',
  Curative: 'bg-red-100 text-red-700',
  Préventive: 'bg-blue-100 text-blue-700',
  'Vidange GE': 'bg-amber-100 text-amber-700',
  'TGBT/AVR': 'bg-indigo-100 text-indigo-700',
  'Curage cuve': 'bg-cyan-100 text-cyan-700',
};

const n = (v: unknown): number | null => (v == null ? null : Number(v));

function fusionnerPassages(rows: Releve[]): Passage[] {
  const parCle = new Map<string, Passage>();
  const ordre: string[] = [];
  for (const r of rows) {
    // Même intervention (maintenance) ou, à défaut, même site + même minute.
    const cle = r.maintenance?.id
      ? `m:${r.maintenance.id}`
      : `s:${r.siteId}|${r.dateReleve.slice(0, 16)}|${r.provenance ?? ''}`;
    let p = parCle.get(cle);
    if (!p) {
      p = {
        id: r.id, siteNom: r.site?.nom ?? '—', dateReleve: r.dateReleve,
        provenance: r.provenance,
        technicien: r.technicien ? `${r.technicien.prenom} ${r.technicien.nom}` : undefined,
        ges: [],
      };
      parCle.set(cle, p); ordre.push(cle);
    }
    if (r.source === 'CEET') {
      p.indexCompteur = n(r.indexCompteur); p.consommationKwh = n(r.consommationKwh);
    } else if (r.source === 'GE') {
      if (p.jaugeLitres == null) p.jaugeLitres = n(r.volumeGasoilLitres);
      if (p.gasoilConsommeLitres == null) p.gasoilConsommeLitres = n(r.gasoilConsommeLitres);
      p.ges.push({ numero: r.groupe?.numero ?? null, index: n(r.indexHeuresGE), marche: n(r.heuresFonctGE) });
    } else if (r.source === 'SOLAIRE') {
      p.puissanceKva = n(r.puissanceKva);
    }
  }
  return ordre.map((c) => parCle.get(c)!);
}

const listeGE = (p: Passage, champ: 'index' | 'marche', suffixe: string) => {
  const vals = p.ges.filter((g) => g[champ] != null);
  if (!vals.length) return '—';
  if (vals.length === 1) return `${fmtNumber(vals[0][champ]!)}${suffixe}`;
  return vals.map((g) => `n°${g.numero ?? '?'} ${fmtNumber(g[champ]!)}${suffixe}`).join(' · ');
};

const FILTRES_DEFAUT = { page: '1', search: '', source: '', du: '', au: '', tri: '', sens: '' };

function RelevesPageInner() {
  const router = useRouter();
  // Filtres dans l'URL : ouvrir un passage puis revenir ne doit pas effacer la
  // période et la source — et un lien filtré se partage tel quel.
  const { valeurs, appliquer } = useFiltresUrl(FILTRES_DEFAUT);
  const page = Number(valeurs.page) || 1;
  const setPage = (p: number) => appliquer({ page: String(p) });
  const { source, du, au } = valeurs;
  // Tri d'en-tête délégué au serveur (pagination serveur : un tri local ne
  // réordonnerait que la page affichée). Vide = relevés récents d'abord.
  const tri = valeurs.tri ? { key: valeurs.tri, dir: (valeurs.sens === 'desc' ? -1 : 1) as 1 | -1 } : null;
  const [search, setSearch] = useState(valeurs.search);
  const debounced = useDebounce(search);
  useEffect(() => {
    if (debounced !== valeurs.search) appliquer({ search: debounced, page: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['releves', { page, source, debounced, du, au, tri }],
    queryFn: () => api.get('/releves', {
      params: {
        page, limit: 30,
        source: source || undefined,
        search: debounced || undefined,
        date_debut: du || undefined, date_fin: au || undefined,
        tri: tri?.key, sens: tri ? (tri.dir === 1 ? 'asc' : 'desc') : undefined,
      },
    }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const rows: Releve[] = data?.data ?? [];
  const passages = fusionnerPassages(rows);
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Passage>[] = [
    { key: 'siteNom', header: 'Site', render: (p) => <span className="font-medium text-gray-800">{p.siteNom}</span> },
    { key: 'dateReleve', header: 'Date', render: (p) => fmtDate(p.dateReleve) },
    // Provenance et jauge : calculées côté client (maintenance liée, fusion GE)
    // → pas de tri serveur possible.
    { key: 'provenance', header: 'Provenance', sortable: false, render: (p) => <Badge className={PROVENANCE_COLOR[p.provenance ?? ''] || 'bg-gray-100 text-gray-600'}>{p.provenance ?? '—'}</Badge> },
    { key: 'technicien', header: 'Technicien', defaultHidden: true, render: (p) => p.technicien ?? '—' },
    { key: 'jaugeLitres', header: 'Jauge cuve (L)', align: 'right', sortable: false, render: (p) => p.jaugeLitres != null ? fmtNumber(p.jaugeLitres) : '—' },
    { key: 'gasoilConsommeLitres', header: 'Gasoil conso (L)', align: 'right', render: (p) => p.gasoilConsommeLitres != null ? fmtNumber(p.gasoilConsommeLitres) : '—' },
    { key: 'indexGE', header: 'Index GE (h)', align: 'right', sortable: false, render: (p) => listeGE(p, 'index', '') },
    { key: 'marcheGE', header: 'Marche GE (h)', align: 'right', sortable: false, render: (p) => listeGE(p, 'marche', '') },
    { key: 'indexCompteur', header: 'Index CEET', align: 'right', render: (p) => p.indexCompteur != null ? fmtNumber(p.indexCompteur) : '—' },
    { key: 'consommationKwh', header: 'Conso (kWh)', align: 'right', render: (p) => p.consommationKwh != null ? fmtNumber(p.consommationKwh) : '—' },
    { key: 'puissanceKva', header: 'Solaire (kVA)', align: 'right', defaultHidden: true, render: (p) => p.puissanceKva != null ? fmtNumber(p.puissanceKva) : '—' },
  ];

  const exportQuery = [
    source && `source=${source}`,
    debounced && `search=${encodeURIComponent(debounced)}`,
    du && `date_debut=${du}`,
    au && `date_fin=${au}`,
  ].filter(Boolean).join('&');

  return (
    <div>
      <PageHeader
        title="Relevés énergie"
        subtitle="Un passage par ligne - jauges et index saisis, consommations calculées entre deux passages"
        backHref="/energie"
        actions={<ExportButtons base="/releves/export" name="releves" query={exportQuery || undefined} />}
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Rechercher un site…"
        filters={[{ key: 'source', label: 'Toutes sources', value: source, options: SOURCES_ENERGIE, onChange: (v) => appliquer({ source: v, page: '1' }) }]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">Période :</span>
        <input type="date" value={du} onChange={(e) => appliquer({ du: e.target.value, page: '1' })}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-[rgb(var(--brand-light))]" />
        <span className="text-gray-400">→</span>
        <input type="date" value={au} onChange={(e) => appliquer({ au: e.target.value, page: '1' })}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-[rgb(var(--brand-light))]" />
        {(du || au) && (
          <button type="button" onClick={() => appliquer({ du: '', au: '', page: '1' })}
            className="text-xs font-medium text-[rgb(var(--brand-light))] hover:underline">Effacer</button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton cols={9} />
      ) : isError ? (
        <ErrorState />
      ) : passages.length === 0 ? (
        <EmptyState title="Aucun relevé" />
      ) : (
        <>
          <DataTable columns={columns} data={passages} maxHeight="65vh" onRowClick={(p) => router.push(`/energie/releves/${p.id}`)}
            serverSort={tri}
            onServerSort={(s) => appliquer({ tri: s?.key ?? '', sens: s && s.dir === -1 ? 'desc' : '', page: '1' })} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}

/**
 * Les filtres vivent dans la query (useFiltresUrl) : Next exige alors une
 * frontière Suspense, sinon le prérendu de la page échoue à la construction.
 */
export default function RelevesPage() {
  return (
    <Suspense fallback={<TableSkeleton cols={6} />}>
      <RelevesPageInner />
    </Suspense>
  );
}
