'use client';

import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldOff, Plus, X, TriangleAlert, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { StatCard } from '@/components/shared/StatCard';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select, Textarea } from '@/components/shared/Form';
import { SearchSelect } from '@/components/shared/SearchSelect';
import { fmtDate } from '@/lib/utils';

interface Exclusion {
  id: string;
  tacheKey: string;
  tacheLibelle: string;
  motif: string;
  debutLe: string;
  finLe: string | null;
  site: { id: string; code: string; nom: string; region: string; typeSite: string | null };
  auteur: { nom: string; prenom: string } | null;
}
interface Tache { key: string; libelle: string; frequence: string; categorie: string }
interface TypeSite { code: string; libelle: string }

/** Premier jour du mois prochain : une exclusion ne coupe pas un mois en deux. */
function moisProchain(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/**
 * EXCLUSIONS CONTRACTUELLES - ce qui n'est PAS dû, et depuis quand.
 *
 * L'éligibilité technique dit si le site a l'équipement ; cet écran dit si son
 * entretien est au contrat. Un centre technique a bien un groupe électrogène,
 * mais son entretien n'incombe pas au prestataire passif : la tâche doit sortir
 * du dû, sans faire mentir le catalogue sur l'équipement présent.
 */
function DeclarerModal({ taches, typesSite, onClose }: {
  taches: Tache[]; typesSite: TypeSite[]; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [portee, setPortee] = useState<'TYPE' | 'SITES'>('TYPE');
  const [typeSite, setTypeSite] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [cles, setCles] = useState<string[]>([]);
  const [motif, setMotif] = useState('');
  const [debutLe, setDebutLe] = useState(moisProchain());
  const [erreur, setErreur] = useState('');

  // `all` (et non `limit`) : le paginateur plafonne à 200, ce qui tronquait
  // silencieusement la liste - les sites au-delà du 200e par ordre alphabétique
  // n'apparaissaient jamais. `light` évite d'embarquer le barémage des cuves.
  const { data: sites } = useQuery({
    queryKey: ['sites-exclusion'],
    queryFn: () => api.get('/sites', { params: { all: 'true', light: 'true' } }).then(
      (r) => r.data.data as Array<{ id: string; code: string; nom: string }>),
    enabled: portee === 'SITES',
  });

  const combien = useQuery({
    queryKey: ['sites-du-type', typeSite],
    queryFn: () => api.get('/sites', { params: { limit: 1, type_site: typeSite } }).then((r) => r.data.meta?.total ?? 0),
    enabled: portee === 'TYPE' && !!typeSite,
  });

  const poser = useMutation({
    mutationFn: () => api.post('/exclusions', {
      ...(portee === 'TYPE' ? { typeSite } : { siteIds }),
      tacheKeys: cles, motif, debutLe,
    }).then((r) => r.data.data as { creees: number; dejaEnVigueur: number; sites: number }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['exclusions'] }); onClose(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setErreur(e.response?.data?.error || 'Erreur'),
  });

  const bascule = (k: string) => setCles((c) => c.includes(k) ? c.filter((x) => x !== k) : [...c, k]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">Déclarer une exclusion contractuelle</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X size={18} /></button>
        </div>
        {erreur && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erreur}</div>}

        <div className="mb-4 flex gap-2">
          {([['TYPE', 'Toute une nature de site'], ['SITES', 'Des sites choisis']] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setPortee(v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${portee === v ? 'border-[rgb(var(--brand))] bg-[rgb(var(--brand))] text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>

        {portee === 'TYPE' ? (
          <Field label="Nature de site" required>
            <Select value={typeSite} onChange={(e) => setTypeSite(e.target.value)}
              options={typesSite.map((t) => ({ value: t.code, label: t.libelle }))} placeholder="Choisir…" />
            {typeSite && combien.data != null && (
              <p className="mt-1 text-xs text-gray-500">{combien.data} site(s) actif(s) de cette nature seront concernés.</p>
            )}
          </Field>
        ) : (
          <Field label="Sites" required>
            <SearchSelect value="" onChange={(id) => setSiteIds((s) => s.includes(id) ? s : [...s, id])}
              options={(sites ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.nom}` }))}
              placeholder="Ajouter un site…" />
            <div className="mt-2 flex flex-wrap gap-1">
              {siteIds.map((id) => {
                const s = sites?.find((x) => x.id === id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                    {s ? s.code : id.slice(0, 8)}
                    <button type="button" onClick={() => setSiteIds((l) => l.filter((x) => x !== id))}><X size={11} /></button>
                  </span>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Tâches hors contrat" required className="mt-3">
          <div className="grid grid-cols-2 gap-1.5">
            {taches.map((t) => (
              <label key={t.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${cles.includes(t.key) ? 'border-[rgb(var(--brand))] bg-[rgb(var(--brand))]/5' : 'border-gray-200'}`}>
                <input type="checkbox" checked={cles.includes(t.key)} onChange={() => bascule(t.key)} className="mt-0.5" />
                <span><span className="font-medium text-gray-800">{t.libelle}</span><span className="block text-gray-400">{t.key}</span></span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Motif" required className="mt-3">
          <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} rows={2}
            placeholder="Ex. : entretien GE assuré par le constructeur - hors contrat passif" />
        </Field>

        <Field label="Prise d’effet" required className="mt-3">
          <Input type="date" value={debutLe} onChange={(e) => setDebutLe(e.target.value)} />
          {/* La date n'est pas un détail : les fiches de validation antérieures
              sont signées, et leurs chiffres ne doivent pas changer. */}
          <p className="mt-1 text-xs text-gray-500">
            Les mois antérieurs restent inchangés : leurs fiches de validation sont signées et doivent se relire à l’identique.
          </p>
        </Field>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button onClick={() => { setErreur(''); poser.mutate(); }} loading={poser.isPending}
            disabled={!cles.length || !motif.trim() || (portee === 'TYPE' ? !typeSite : !siteIds.length)}>
            Déclarer
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ExclusionsPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const peutDeclarer = ['MANAGER', 'ADMIN'].includes(role);
  const [modal, setModal] = useState(false);
  const [voirHistorique, setVoirHistorique] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['exclusions', voirHistorique],
    queryFn: () => api.get('/exclusions', { params: { actives: voirHistorique ? undefined : 'true' } })
      .then((r) => r.data as { data: Exclusion[]; meta: { total: number; actives: number } }),
  });

  const { data: catalogues } = useQuery({
    queryKey: ['exclusions-catalogues'],
    queryFn: () => api.get('/exclusions/catalogues').then((r) => r.data.data as { passif: Tache[]; solaire: Tache[] }),
    staleTime: 10 * 60_000,
  });
  const { data: typesSite } = useQuery({
    queryKey: ['types-site'],
    queryFn: () => api.get('/types-site').then((r) => r.data.data as TypeSite[]),
    staleTime: 10 * 60_000,
  });

  const lever = useMutation({
    mutationFn: (id: string) => api.post(`/exclusions/${id}/lever`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exclusions'] }),
  });

  const taches = useMemo(() => [...(catalogues?.passif ?? []), ...(catalogues?.solaire ?? [])], [catalogues]);
  const lignes = data?.data ?? [];

  const cols: Column<Exclusion>[] = [
    { key: 'site', header: 'Site', render: (e) => (
      <span className="block max-w-[190px] truncate font-medium text-gray-800" title={`${e.site.code} · ${e.site.nom}`}>
        {e.site.nom}
      </span>
    ) },
    { key: 'region', header: 'Région', render: (e) => e.site.region },
    { key: 'tache', header: 'Tâche hors contrat', render: (e) => (
      <span className="block max-w-[260px] truncate" title={`${e.tacheLibelle} (${e.tacheKey})`}>{e.tacheLibelle}</span>
    ) },
    { key: 'motif', header: 'Motif', render: (e) => (
      <span className="block max-w-[220px] truncate text-xs text-gray-500" title={e.motif}>{e.motif}</span>
    ) },
    { key: 'periode', header: 'Période', render: (e) => (
      <span className="whitespace-nowrap text-xs">
        du {fmtDate(e.debutLe)}{e.finLe ? ` au ${fmtDate(e.finLe)}` : ''}
      </span>
    ) },
    { key: 'etat', header: 'État', align: 'center', render: (e) => e.finLe
      ? <Badge className="bg-gray-100 text-gray-500">Levée</Badge>
      : <Badge className="bg-amber-100 text-amber-800">En vigueur</Badge> },
    { key: 'auteur', header: 'Déclarée par', render: (e) => (
      <span className="text-xs text-gray-500">{e.auteur ? `${e.auteur.prenom} ${e.auteur.nom}` : '-'}</span>
    ) },
    ...(peutDeclarer ? [{
      key: 'actions', header: '', align: 'right' as const, render: (e: Exclusion) => e.finLe ? null : (
        <button
          onClick={() => { if (confirm(`Lever l'exclusion « ${e.tacheLibelle} » sur ${e.site.nom} ?\nLa tâche redeviendra due à partir d'aujourd'hui. L'historique est conservé.`)) lever.mutate(e.id); }}
          title="Lever l'exclusion" className="rounded p-1.5 hover:bg-gray-100">
          <Undo2 size={15} className="text-[#7D3C98]" />
        </button>
      ),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Exclusions contractuelles"
        subtitle="Tâches du catalogue qui ne sont pas dues sur certains sites - le dû, pas l’équipement"
        backHref="/administration"
        actions={peutDeclarer ? <Button icon={Plus} onClick={() => setModal(true)}>Déclarer</Button> : undefined}
      />

      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
        Une exclusion dit que <b>l’entretien n’est pas au contrat</b>, pas que l’équipement est absent : le site garde son
        groupe électrogène dans sa fiche, la tâche sort simplement du dû. Elle ressort <b>NA</b> au rapport de conformité,
        jamais <b>NOK</b> - on ne reproche pas un manquement hors périmètre. Elle ne se supprime pas, elle se <b>lève</b> à
        une date : les fiches de validation déjà signées doivent pouvoir se relire à l’identique.
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard title="En vigueur" value={String(data?.meta.actives ?? 0)} subtitle="couples site / tâche" icon={ShieldOff} color="bg-[#B8860B]" />
        <StatCard title="Enregistrées" value={String(data?.meta.total ?? 0)} subtitle="levées comprises" icon={TriangleAlert} color="bg-[rgb(var(--brand))]" />
      </div>

      <label className="mb-3 inline-flex cursor-pointer items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={voirHistorique} onChange={(e) => setVoirHistorique(e.target.checked)} />
        Afficher aussi les exclusions levées
      </label>

      {isLoading ? <TableSkeleton cols={7} />
        : isError ? <ErrorState />
        : lignes.length === 0 ? (
          <EmptyState title="Aucune exclusion"
            hint="Tant qu’aucune exclusion n’est déclarée, toute tâche techniquement applicable est due." />
        ) : <DataTable columns={cols} data={lignes} rowKey={(e) => e.id} />}

      {modal && <DeclarerModal taches={taches} typesSite={typesSite ?? []} onClose={() => setModal(false)} />}
    </div>
  );
}
