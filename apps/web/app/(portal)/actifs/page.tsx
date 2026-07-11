'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Boxes, CheckCircle2, Warehouse, Truck, Archive, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select } from '@/components/shared/Form';

interface Actif {
  id: string;
  actifType: string;
  categorie: string;
  numeroSerie: string | null;
  libelle: string | null;
  caracteristique: string | null;
  statutActif: string;
  siteId: string | null;
  site: { code: string; nom: string } | null;
  marque: string | null;
  updatedAt: string | null;
  heuresDepuisVidange: number | null;
  vidangeDue: boolean;
  dernierIndexHeures: number | null;
  numero: number | null;
}

const STATUT_COLOR: Record<string, string> = {
  EN_SERVICE: 'bg-green-100 text-green-700',
  EN_STOCK: 'bg-gray-100 text-gray-600',
  EN_TRANSIT: 'bg-amber-100 text-amber-700',
  REFORME: 'bg-red-100 text-red-700',
};
const STATUT_LABEL: Record<string, string> = {
  EN_SERVICE: 'En service', EN_STOCK: 'Au dépôt', EN_TRANSIT: 'En transit', REFORME: 'Réformé',
};
const TYPE_OPTIONS = [
  { value: 'GE', label: 'Groupe électrogène' },
  { value: 'BATTERIE', label: 'Batterie' },
  { value: 'CLIMATISEUR', label: 'Climatiseur' },
];
const STATUT_OPTIONS = [
  { value: 'EN_SERVICE', label: 'En service' },
  { value: 'EN_STOCK', label: 'Au dépôt' },
  { value: 'EN_TRANSIT', label: 'En transit' },
  { value: 'REFORME', label: 'Réformé' },
];

function CreateActifModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ actifType: 'GE', numeroSerie: '', libelle: '', puissanceKva: '', valeur: '', unite: '', marque: '' });
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isGE = form.actifType === 'GE';

  const mutation = useMutation({
    mutationFn: () => api.post('/actifs', {
      actifType: form.actifType,
      numeroSerie: form.numeroSerie || undefined,
      libelle: form.libelle || undefined,
      puissanceKva: isGE && form.puissanceKva ? Number(form.puissanceKva) : undefined,
      marque: isGE && form.marque ? form.marque : undefined,
      valeur: !isGE && form.valeur ? Number(form.valeur) : undefined,
      unite: !isGE ? form.unite || undefined : undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['actifs'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Nouvel actif</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <p className="mb-3 text-xs text-gray-500">L’actif est enregistré au dépôt (EN_STOCK). Il sera posé sur un site via un travail d’installation.</p>
        {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-2 gap-3">
          <Field label="Type" required>
            <Select value={form.actifType} onChange={(e) => set('actifType', e.target.value)} options={[{ value: 'GE', label: 'Groupe électrogène' }, { value: 'BATTERIE', label: 'Batterie' }, { value: 'CLIMATISEUR', label: 'Climatiseur' }]} />
          </Field>
          <Field label="N° série"><Input value={form.numeroSerie} onChange={(e) => set('numeroSerie', e.target.value)} /></Field>
          <Field label="Libellé" className="col-span-2"><Input value={form.libelle} onChange={(e) => set('libelle', e.target.value)} placeholder={isGE ? '(auto)' : 'ex. Batterie 200 Ah'} /></Field>
          {isGE ? (
            <>
              <Field label="Puissance (kVA)"><Input type="number" value={form.puissanceKva} onChange={(e) => set('puissanceKva', e.target.value)} /></Field>
              <Field label="Marque"><Input value={form.marque} onChange={(e) => set('marque', e.target.value)} placeholder="ex: CATERPILLAR" /></Field>
            </>
          ) : (
            <>
              <Field label="Caractéristique"><Input type="number" value={form.valeur} onChange={(e) => set('valeur', e.target.value)} placeholder="ex. 200" /></Field>
              <Field label="Unité"><Input value={form.unite} onChange={(e) => set('unite', e.target.value)} placeholder="Ah, BTU…" /></Field>
            </>
          )}
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={mutation.isPending}>Enregistrer</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const JOURS_TRANSIT_ALERTE = 7; // au-delà : mouvement probablement bloqué/perdu

export default function ActifsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const canCreate = role === 'MANAGER' || role === 'ADMIN';
  const [showCreate, setShowCreate] = useState(false);
  const [type, setType] = useState('');
  const [statut, setStatut] = useState('');
  const [marque, setMarque] = useState('');
  const [search, setSearch] = useState('');
  const [showRecap, setShowRecap] = useState(false);

  // Le parc complet tient en une requête : stats globales + filtres instantanés côté client.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['actifs'],
    queryFn: () => api.get('/actifs').then((r) => r.data.data),
  });

  const parc: Actif[] = data ?? [];
  const marqueOptions = [
    ...[...new Set(parc.map((a) => a.marque).filter(Boolean))].sort().map((m) => ({ value: m as string, label: m as string })),
    ...(parc.some((a) => a.actifType === 'GE' && !a.marque) ? [{ value: '__SANS__', label: 'Sans marque' }] : []),
  ];

  const q = search.trim().toLowerCase();
  const bySiteThenNumero = (x: Actif, y: Actif) => {
    if (!!x.site !== !!y.site) return x.site ? -1 : 1; // dépôt en fin de liste
    const c = (x.site?.code ?? '').localeCompare(y.site?.code ?? '');
    return c !== 0 ? c : (x.numero ?? 99) - (y.numero ?? 99);
  };
  const rows = parc.filter((a) =>
    (!type || a.actifType === type) &&
    (!statut || a.statutActif === statut) &&
    (!marque || (marque === '__SANS__' ? (a.actifType === 'GE' && !a.marque) : a.marque === marque)) &&
    (!q || [a.libelle, a.numeroSerie, a.marque, a.site?.code, a.site?.nom]
      .some((v) => v?.toLowerCase().includes(q)))
  ).sort(bySiteThenNumero);

  const nb = (s: string) => parc.filter((a) => a.statutActif === s).length;

  // ── Récap GE : marque × puissance (hors réformés) ──
  const SANS_MARQUE = 'Sans marque';
  const ges = parc.filter((a) => a.actifType === 'GE' && a.statutActif !== 'REFORME');
  const kvaOf = (a: Actif) => parseInt(a.caracteristique ?? '0', 10) || 0;
  const puissances = [...new Set(ges.map(kvaOf))].sort((x, y) => x - y);
  const marques = [...new Set(ges.map((a) => a.marque ?? SANS_MARQUE))]
    .sort((x, y) => (x === SANS_MARQUE ? 1 : y === SANS_MARQUE ? -1 : x.localeCompare(y)));
  const nbGE = (m: string, kva?: number) =>
    ges.filter((a) => (a.marque ?? SANS_MARQUE) === m && (kva == null || kvaOf(a) === kva)).length;
  const joursTransit = (a: Actif) =>
    a.updatedAt ? Math.floor((Date.now() - new Date(a.updatedAt).getTime()) / 86400000) : null;

  const columns: Column<Actif>[] = [
    { key: 'site', header: 'Site', render: (a) => (a.site ? <span className="font-medium text-gray-800">{a.site.nom}</span> : <span className="text-gray-400">Dépôt</span>) },
    { key: 'numero', header: 'N° GE', render: (a) => (a.numero != null ? <span className="font-semibold text-gray-700">{a.numero}</span> : <span className="text-gray-300">—</span>) },
    { key: 'libelle', header: 'Actif', render: (a) => <span className="font-medium text-gray-800">{a.actifType === 'GE' ? (a.caracteristique ?? '—') : (a.libelle ?? a.categorie)}</span> },
    { key: 'categorie', header: 'Type', render: (a) => TYPE_OPTIONS.find((t) => t.value === a.actifType)?.label ?? a.actifType },
    { key: 'numeroSerie', header: 'N° série', render: (a) => a.numeroSerie || '—' },
    { key: 'marque', header: 'Marque', render: (a) => a.marque || '—' },
    {
      key: 'statutActif', header: 'Statut', render: (a) => {
        const j = a.statutActif === 'EN_TRANSIT' ? joursTransit(a) : null;
        const bloque = j != null && j >= JOURS_TRANSIT_ALERTE;
        return (
          <span className="inline-flex items-center gap-1.5">
            <Badge className={bloque ? 'bg-red-100 text-red-700' : STATUT_COLOR[a.statutActif] || 'bg-gray-100 text-gray-600'}>
              {STATUT_LABEL[a.statutActif] ?? a.statutActif}
            </Badge>
            {j != null && j > 0 && (
              <span className={`text-xs ${bloque ? 'font-semibold text-red-600' : 'text-gray-400'}`} title={bloque ? 'Mouvement probablement bloqué — vérifier' : undefined}>
                depuis {j} j{bloque ? ' ⚠' : ''}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'index', header: 'Index heures', render: (a) =>
        a.dernierIndexHeures == null ? <span className="text-gray-300">—</span> : <span className="text-gray-700">{Math.round(a.dernierIndexHeures).toLocaleString('fr-FR')} h</span>,
    },
    {
      key: 'vidange', header: 'Vidange', render: (a) =>
        a.heuresDepuisVidange == null ? <span className="text-gray-300">—</span> : (
          <span className={a.vidangeDue ? 'font-semibold text-amber-700' : 'text-gray-500'}>
            {Math.round(a.heuresDepuisVidange)} h{a.vidangeDue ? ' ⚠' : ''}
          </span>
        ),
    },
  ];

  const statCard = (label: string, value: number, Icon: React.ElementType, cls: string, filtre: string) => (
    <button
      type="button"
      onClick={() => setStatut(statut === filtre ? '' : filtre)}
      className={`flex items-center gap-3 rounded-xl border bg-white p-4 text-left transition hover:border-gray-300 ${statut === filtre ? 'border-[#2471A3] ring-1 ring-[#2471A3]/30' : 'border-gray-100'}`}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-white ${cls}`}><Icon size={17} /></span>
      <span>
        <span className="block text-lg font-bold leading-tight text-gray-800">{value}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </span>
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Parc d'actifs"
        subtitle="Groupes électrogènes, batteries, climatiseurs"
        actions={
          <>
            <ExportButtons base="/actifs/export" name="parc-actifs" />
            {canCreate && <Button icon={Plus} onClick={() => setShowCreate(true)}>Nouvel actif</Button>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1B3F6B] text-white"><Boxes size={17} /></span>
          <span>
            <span className="block text-lg font-bold leading-tight text-gray-800">{parc.length}</span>
            <span className="text-xs text-gray-500">Actifs au total</span>
          </span>
        </div>
        {statCard('En service', nb('EN_SERVICE'), CheckCircle2, 'bg-[#0E7C6B]', 'EN_SERVICE')}
        {statCard('Au dépôt', nb('EN_STOCK'), Warehouse, 'bg-gray-500', 'EN_STOCK')}
        {statCard('En transit', nb('EN_TRANSIT'), Truck, 'bg-[#F59E0B]', 'EN_TRANSIT')}
        {statCard('Réformés', nb('REFORME'), Archive, 'bg-[#DC2626]', 'REFORME')}
      </div>

      {ges.length > 0 && (
        <div className="mb-4 rounded-xl border border-gray-100 bg-white">
          <button
            type="button"
            onClick={() => setShowRecap((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700"
          >
            <span>Répartition des GE par marque et puissance ({ges.length} GE hors réformés)</span>
            {showRecap ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showRecap && (
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="py-2 pr-4 font-medium">Marque</th>
                    {puissances.map((kva) => (
                      <th key={kva} className="px-3 py-2 text-center font-medium">{kva ? `${kva} kVA` : 'kVA ?'}</th>
                    ))}
                    <th className="px-3 py-2 text-center font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {marques.map((m) => (
                    <tr key={m} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-4">
                        <button
                          type="button"
                          onClick={() => {
                            const cible = m === SANS_MARQUE ? '__SANS__' : m;
                            setMarque(marque === cible ? '' : cible);
                          }}
                          className={`font-medium hover:underline ${marque === (m === SANS_MARQUE ? '__SANS__' : m) ? 'text-[#2471A3]' : 'text-gray-800'}`}
                          title={m === SANS_MARQUE ? 'Lister les GE dont la marque reste à renseigner' : 'Filtrer la liste sur cette marque'}
                        >
                          {m}
                        </button>
                      </td>
                      {puissances.map((kva) => {
                        const n = nbGE(m, kva);
                        return (
                          <td key={kva} className={`px-3 py-2 text-center ${n ? 'text-gray-800' : 'text-gray-200'}`}>{n || '·'}</td>
                        );
                      })}
                      <td className="px-3 py-2 text-center font-semibold text-gray-800">{nbGE(m)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-gray-100 text-xs text-gray-500">
                    <td className="py-2 pr-4 font-semibold">Total</td>
                    {puissances.map((kva) => (
                      <td key={kva} className="px-3 py-2 text-center font-semibold">{ges.filter((a) => kvaOf(a) === kva).length}</td>
                    ))}
                    <td className="px-3 py-2 text-center font-bold text-gray-800">{ges.length}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="N° série, libellé, marque, site…"
        filters={[
          { key: 'type', label: 'Tous types', value: type, options: TYPE_OPTIONS, onChange: setType },
          { key: 'statut', label: 'Tous statuts', value: statut, options: STATUT_OPTIONS, onChange: setStatut },
          ...(marqueOptions.length ? [{ key: 'marque', label: 'Toutes marques', value: marque, options: marqueOptions, onChange: setMarque }] : []),
        ]}
      />

      {isLoading ? (
        <TableSkeleton cols={8} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucun actif" hint={parc.length ? 'Aucun résultat avec ces filtres.' : 'Enregistrez un GE, une batterie ou un climatiseur.'} />
      ) : (
        <DataTable columns={columns} data={rows} onRowClick={(a) => router.push(`/actifs/${a.actifType}/${a.id}`)} />
      )}

      {showCreate && <CreateActifModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
