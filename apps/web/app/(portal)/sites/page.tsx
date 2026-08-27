'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, MapPin, Upload, FileDown, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Button, ButtonLink } from '@/components/shared/Button';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { regionOptions, STATUTS_GE, POWER_CONFIGS } from '@/lib/constants';
import { SiteOptionnel } from '@/lib/optionalColumns';
import { useColonnesOptionnelles } from '@/lib/hooks/useColonnesOptionnelles';

interface Site extends SiteOptionnel {
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
  // Création réservée MANAGER/ADMIN (rbac serveur) : le bouton suit le droit —
  // un superviseur (interne ou prestataire) ne doit pas voir un bouton en 403.
  const peutCreer = ['MANAGER', 'ADMIN'].includes((session?.user as { role?: string })?.role ?? '');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [statutGe, setStatutGe] = useState('');
  // Config énergie MULTI (pastilles) : vide = toutes ; OU entre cochées —
  // « tout ce qui a du solaire » = Solaire + Hybride GE + Hybride CEET+GE.
  const [configsFiltre, setConfigsFiltre] = useState<Set<string>>(new Set());
  const [prestataireId, setPrestataireId] = useState('');
  const [showImport, setShowImport] = useState(false);
  // Tri d'en-tête délégué au serveur (pagination serveur : un tri local ne
  // réordonnerait que la page affichée). null = tri par nom.
  const [tri, setTri] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const debouncedSearch = useDebounce(search);

  // Filtre prestataire : INTERNES uniquement — un utilisateur rattaché à un
  // prestataire ne voit déjà que ses sites, le filtre serait du bruit.
  const role = (session?.user as { role?: string })?.role ?? '';
  const { data: maSociete } = useQuery({
    queryKey: ['ma-societe'],
    queryFn: () => api.get('/ma-societe').then((r) => r.data.data as { nom: string } | null),
    enabled: role === 'SUPERVISEUR',
    staleTime: 60_000,
  });
  const filtrePrestataire = ['MANAGER', 'ADMIN', 'DIRECTION', 'NOC'].includes(role)
    || (role === 'SUPERVISEUR' && !maSociete);
  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data as { id: string; nom: string }[]),
    enabled: filtrePrestataire,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sites', { page, debouncedSearch, region, statutGe, configs: [...configsFiltre].sort().join(','), prestataireId, tri }],
    queryFn: () =>
      api
        .get('/sites', {
          params: {
            page, limit: 20, search: debouncedSearch || undefined, region: region || undefined, statut_ge: statutGe || undefined,
            power_configs: configsFiltre.size ? [...configsFiltre].join(',') : undefined,
            prestataire_id: prestataireId || undefined,
            tri: tri?.key, sens: tri ? (tri.dir === 1 ? 'asc' : 'desc') : undefined,
          },
        })
        .then((r) => r.data),
  });

  const sites: Site[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const colonnesOptionnelles = useColonnesOptionnelles<Site>('sites');

  const columns: Column<Site>[] = [
    { key: 'nom', header: 'Nom', render: (s) => <span className="font-medium text-gray-800">{s.nom}</span> },
    { key: 'region', header: 'Région' },
    { key: 'ville', header: 'Ville', render: (s) => s.ville || '—' },
    { key: 'powerConfig', header: 'Config énergie', render: (s) => POWER_CONFIGS.find((p) => p.value === s.powerConfig)?.label ?? s.powerConfig },
    { key: 'statutGE', header: 'Statut GE', render: (s) => STATUTS_GE.find((p) => p.value === s.statutGE)?.label ?? s.statutGE },
    { key: 'puissanceGEkva', header: 'Puissance GE (kVA)', align: 'right', render: (s) => s.puissanceGEkva != null && !Number.isNaN(Number(s.puissanceGEkva)) ? Number(s.puissanceGEkva).toFixed(0) : '—' },
    ...colonnesOptionnelles,
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
            {((session?.user as { role?: string })?.role ?? '') !== 'TECHNICIEN' && <ExportButtons base="/sites/export" name="sites" query={[
              region && `region=${region}`,
              statutGe && `statut_ge=${statutGe}`,
              configsFiltre.size > 0 && `power_configs=${[...configsFiltre].join(',')}`,
              prestataireId && `prestataire_id=${prestataireId}`,
            ].filter(Boolean).join('&') || undefined} />}
            {peutCreer && <ButtonLink href="/sites/nouveau" icon={Plus}>Nouveau site</ButtonLink>}
          </>
        }
      />

      {showImport && <ImportSitesModal onClose={() => setShowImport(false)} />}

      <CouvertureCuvesBloc />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Rechercher par nom ou région…"
        filters={[
          { key: 'region', label: 'Toutes régions', value: region, options: regionOptions, onChange: (v) => { setRegion(v); setPage(1); } },
          { key: 'statut', label: 'Tous statuts GE', value: statutGe, options: STATUTS_GE, onChange: (v) => { setStatutGe(v); setPage(1); } },
          ...(filtrePrestataire ? [{
            key: 'prestataire', label: 'Tous prestataires', value: prestataireId,
            options: (prestataires ?? []).map((p) => ({ value: p.id, label: p.nom })),
            onChange: (v: string) => { setPrestataireId(v); setPage(1); },
          }] : []),
        ]}
      />

      {/* Config énergie en pastilles multi (OU) - borne la liste ET l'export. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">Config énergie :</span>
        {POWER_CONFIGS.map((c) => (
          <button key={c.value} type="button"
            onClick={() => {
              setConfigsFiltre((prev) => {
                const next = new Set(prev);
                if (next.has(c.value)) next.delete(c.value); else next.add(c.value);
                return next;
              });
              setPage(1);
            }}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${configsFiltre.has(c.value) ? 'border-[#1B3F6B] bg-[#1B3F6B] text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
            {c.label}
          </button>
        ))}
        {configsFiltre.size > 0 && (
          <button type="button" onClick={() => { setConfigsFiltre(new Set()); setPage(1); }}
            className="text-xs font-medium text-[#2471A3] hover:underline">Toutes</button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton cols={7} />
      ) : isError ? (
        <ErrorState />
      ) : sites.length === 0 ? (
        <EmptyState title="Aucun site" hint="Ajustez les filtres ou créez un nouveau site." />
      ) : (
        <>
          <DataTable columns={columns} data={sites} onRowClick={(s) => router.push(`/sites/${s.id}`)}
            serverSort={tri} onServerSort={(s) => { setTri(s); setPage(1); }} />
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

/**
 * Campagne « cuves calculables » : combien de sites avec GE ont une conversion
 * hauteur → litres opérationnelle, et lesquels restent à configurer (à
 * mesurer à la prochaine visite ou à charger depuis un certificat de jaugeage).
 * Masqué quand la campagne est terminée.
 */
function CouvertureCuvesBloc() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['cuves-couverture'],
    queryFn: () => api.get('/sites/cuves/couverture').then((r) => r.data.data as {
      total: number; configures: number; restants: { id: string; nom: string; region: string }[];
    }),
    staleTime: 5 * 60_000,
  });
  if (!data || data.total === 0 || data.restants.length === 0) return null;
  const pct = Math.round((data.configures / data.total) * 100);
  return (
    <div className="mb-4 rounded-xl border border-[#1B3F6B]/15 bg-[#EAF1F8] p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <p className="text-sm text-[#1B3F6B]">
          <span className="font-semibold">Cuves calculables : {data.configures}/{data.total} sites ({pct} %)</span>
          <span className="text-[#1B3F6B]/70"> - {data.restants.length} cuve(s) à configurer (dimensions ou barème) pour la conversion hauteur → litres</span>
        </p>
        <span className="shrink-0 text-xs font-medium text-[#1B3F6B] underline">{open ? 'Masquer' : 'Voir les sites'}</span>
      </button>
      {open && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.restants.map((s) => (
            <button key={s.id} type="button" onClick={() => router.push(`/sites/${s.id}/modifier`)}
              className="rounded-full border border-[#1B3F6B]/20 bg-white px-2.5 py-1 text-xs text-[#1B3F6B] hover:bg-[#1B3F6B]/5"
              title={s.region}>
              {s.nom}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
