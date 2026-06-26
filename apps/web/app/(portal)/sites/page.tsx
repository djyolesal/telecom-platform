'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, MapPin, Upload, FileDown, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Button, ButtonLink } from '@/components/shared/Button';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { regionOptions, STATUTS_GE, POWER_CONFIGS } from '@/lib/constants';

interface Site {
  id: string;
  code: string;
  nom: string;
  region: string;
  ville?: string;
  powerConfig: string;
  statutGE: string;
  puissanceGEkva: number;
}

export default function SitesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string })?.role === 'ADMIN';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [statutGe, setStatutGe] = useState('');
  const [powerConfig, setPowerConfig] = useState('');
  const [showImport, setShowImport] = useState(false);
  const debouncedSearch = useDebounce(search);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sites', { page, debouncedSearch, region, statutGe, powerConfig }],
    queryFn: () =>
      api
        .get('/sites', {
          params: { page, limit: 20, search: debouncedSearch || undefined, region: region || undefined, statut_ge: statutGe || undefined, power_config: powerConfig || undefined },
        })
        .then((r) => r.data),
  });

  const sites: Site[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<Site>[] = [
    { key: 'code', header: 'Code', render: (s) => <span className="font-medium text-gray-800">{s.code}</span> },
    { key: 'nom', header: 'Nom' },
    { key: 'region', header: 'Région' },
    { key: 'ville', header: 'Ville', render: (s) => s.ville || '—' },
    { key: 'powerConfig', header: 'Config énergie', render: (s) => POWER_CONFIGS.find((p) => p.value === s.powerConfig)?.label ?? s.powerConfig },
    { key: 'statutGE', header: 'Statut GE', render: (s) => STATUTS_GE.find((p) => p.value === s.statutGE)?.label ?? s.statutGE },
    { key: 'puissanceGEkva', header: 'kVA', align: 'right', render: (s) => Number(s.puissanceGEkva).toFixed(0) },
  ];

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle="Parc de sites BTS / antennes"
        actions={
          <>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Upload size={15} /> Importer
              </button>
            )}
            <button
              type="button"
              onClick={() => downloadFile(`/sites/export/xlsx${region ? `?region=${region}` : ''}`, 'sites.xlsx')}
              className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Download size={15} /> Export
            </button>
            <ButtonLink href="/sites/nouveau" icon={Plus}>Nouveau site</ButtonLink>
          </>
        }
      />

      {showImport && <ImportSitesModal onClose={() => setShowImport(false)} />}

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Rechercher par nom ou code…"
        filters={[
          { key: 'region', label: 'Toutes régions', value: region, options: regionOptions, onChange: (v) => { setRegion(v); setPage(1); } },
          { key: 'statut', label: 'Statut GE', value: statutGe, options: STATUTS_GE, onChange: (v) => { setStatutGe(v); setPage(1); } },
          { key: 'power', label: 'Config énergie', value: powerConfig, options: POWER_CONFIGS, onChange: (v) => { setPowerConfig(v); setPage(1); } },
        ]}
      />

      {isLoading ? (
        <TableSkeleton cols={7} />
      ) : isError ? (
        <ErrorState />
      ) : sites.length === 0 ? (
        <EmptyState title="Aucun site" hint="Ajustez les filtres ou créez un nouveau site." />
      ) : (
        <>
          <DataTable columns={columns} data={sites} onRowClick={(s) => router.push(`/sites/${s.id}`)} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}

      {!isLoading && sites.length === 0 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
          <MapPin size={14} /> Astuce : la carte temps réel est disponible dans Supervision.
        </div>
      )}
    </div>
  );
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: { ligne: number; code: string; message: string }[];
}

function ImportSitesModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file as File);
      const r = await api.post('/sites/import', form);
      return r.data.data as ImportResult;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites'] }),
  });

  const result = mutation.data;
  const errMsg = (mutation.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">Importer des sites</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <p className="mb-3 text-sm text-gray-600">
          Fichier <b>.xlsx</b> avec les colonnes : <code className="text-xs">code, nom, region, ville, adresse, latitude, longitude, powerConfig, statutGE, puissanceGEkva, lot, typePylone, climatiseur, extincteurs, cuveVolumeLitres, formeCuve, cuveDimensions, puissanceGE2, statutGE2</code>.
          L&apos;import met à jour les sites existants (par <b>code</b>) et crée les nouveaux. La colonne <b>lot</b> (code du lot) rattache le site au prestataire. Renseignez <b>puissanceGE2</b> / <b>statutGE2</b> pour un 2ᵉ groupe électrogène (le GE n°1 = <code className="text-xs">statutGE/puissanceGEkva</code>).
        </p>

        <button
          type="button"
          onClick={() => downloadFile('/sites/import/template', 'modele_import_sites.xlsx')}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[#2471A3] hover:underline"
        >
          <FileDown size={15} /> Télécharger le modèle
        </button>

        <input
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); mutation.reset(); }}
          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
        />

        {errMsg && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertTriangle size={15} /> {errMsg}
          </div>
        )}

        {result && (
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-green-700">
              <CheckCircle2 size={16} /> {result.created} créé(s), {result.updated} mis à jour sur {result.total} ligne(s).
            </div>
            {result.errors.length > 0 && (
              <div className="mt-2">
                <p className="font-medium text-orange-700">{result.errors.length} erreur(s) :</p>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs text-gray-600">
                  {result.errors.map((er, i) => (
                    <li key={i}>Ligne {er.ligne}{er.code ? ` (${er.code})` : ''} : {er.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{result ? 'Fermer' : 'Annuler'}</Button>
          <Button type="button" icon={Upload} loading={mutation.isPending} disabled={!file} onClick={() => mutation.mutate()}>
            Importer
          </Button>
        </div>
      </div>
    </div>
  );
}
