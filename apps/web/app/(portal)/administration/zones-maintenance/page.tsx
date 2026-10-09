'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtNumber } from '@/lib/utils';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Loading, ErrorState } from '@/components/shared/states';

interface Responsable { id: string; nom: string; prenom: string; telephone: string | null; email: string | null; societe: string }
interface Zone { id: string; nom: string; nbSites: number; responsable: Responsable | null }
interface Contact { id: string; nom: string; prenom: string; telephone: string; societe: string; actif: boolean }

interface Apercu {
  applique: boolean;
  zones: Array<{
    nom: string; nouvelle: boolean; fme: string; fmeProbleme: 'INTROUVABLE' | 'AMBIGU' | null; nbSites: number;
    contact: { nom: string; prenom: string; telephone: string } | null; changementFme: boolean;
  }>;
  affectations: number;
  changementsDeZone: Array<{ site: string; avant: string | null; apres: string }>;
  inchanges: number;
  sitesInconnus: Array<{ ligne: number; site: string; zone: string }>;
  sitesAmbigus: Array<{ ligne: number; site: string; candidats: string[] }>;
  contradictions: Array<{ site: string; zones: string[] }>;
  sitesAbsents: Array<{ nom: string; region: string; zoneActuelle: string | null }>;
}

type Erreur = { response?: { data?: { error?: string } } };

/** Télécharge une liste en CSV (séparateur « ; », lisible par Excel en français). */
function telechargerCsv(nom: string, entetes: string[], lignes: (string | number | null)[][]) {
  const cel = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [entetes, ...lignes].map((l) => l.map(cel).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nom; a.click();
  URL.revokeObjectURL(url);
}

function Liste({ titre, aide, nb, onCsv, children }: { titre: string; aide: string; nb: number; onCsv?: () => void; children: React.ReactNode }) {
  if (!nb) return null;
  return (
    <details className="rounded-lg border border-gray-100 bg-white">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <span><span className="font-medium text-gray-800">{titre}</span> <span className="text-gray-400">({fmtNumber(nb)})</span></span>
        {onCsv && (
          <button type="button" onClick={(e) => { e.preventDefault(); onCsv(); }}
            className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--brand-light))] hover:underline">
            <Download size={13} /> CSV
          </button>
        )}
      </summary>
      <div className="border-t border-gray-50 px-4 py-3">
        <p className="mb-2 text-xs text-gray-500">{aide}</p>
        <div className="max-h-64 overflow-auto text-sm">{children}</div>
      </div>
    </details>
  );
}

/**
 * Zones de maintenance : découpage TERRAIN du parc et responsable (FME) de
 * chacune, pris parmi les contacts SMS. Remplies depuis le fichier de
 * l'exploitant (SITENAME / ACTIF MAINTENANCE AREA / FME NAME).
 */
export default function ZonesMaintenancePage() {
  const queryClient = useQueryClient();
  const fichierRef = useRef<HTMLInputElement>(null);
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const { data: zones, isLoading, isError } = useQuery({
    queryKey: ['zones-maintenance'],
    queryFn: () => api.get('/zones-maintenance').then((r) => r.data.data as Zone[]),
  });
  const { data: contacts } = useQuery({
    queryKey: ['contacts-sms'],
    queryFn: () => api.get('/contacts').then((r) => r.data.data as Contact[]),
  });

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['zones-maintenance'] });
    queryClient.invalidateQueries({ queryKey: ['sites'] });
  };
  const erreur = (e: Erreur) => setMessage({ ok: false, texte: e.response?.data?.error || 'Erreur' });

  const importer = useMutation({
    mutationFn: async (appliquer: boolean) => {
      const form = new FormData();
      form.append('file', fichier as File);
      form.append('appliquer', String(appliquer));
      return (await api.post('/admin/zones-maintenance/import', form)).data.data as Apercu;
    },
    onSuccess: (d) => {
      setApercu(d);
      setMessage(d.applique
        ? { ok: true, texte: `Import appliqué : ${fmtNumber(d.affectations)} site(s) rattaché(s) à leur zone.` }
        : null);
      if (d.applique) rafraichir();
    },
    onError: erreur,
  });
  const changerFme = useMutation({
    mutationFn: (p: { id: string; responsableContactId: string | null }) =>
      api.put(`/admin/zones-maintenance/${p.id}`, { responsableContactId: p.responsableContactId }),
    onSuccess: () => { rafraichir(); setMessage({ ok: true, texte: 'Responsable de zone enregistré.' }); },
    onError: erreur,
  });
  const supprimer = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/zones-maintenance/${id}`),
    onSuccess: () => { rafraichir(); setMessage({ ok: true, texte: 'Zone supprimée : ses sites sont désormais sans zone.' }); },
    onError: erreur,
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  const actifs = (contacts ?? []).filter((c) => c.actif);
  const sansZone = apercu?.sitesAbsents.length ?? null;

  return (
    <div>
      <PageHeader
        title="Zones de maintenance"
        subtitle="Découpage terrain du parc et responsable (FME) de chaque zone"
        backHref="/administration"
      />

      {message && (
        <div className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${message.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.texte}
        </div>
      )}

      <section className="mb-6 rounded-xl border border-gray-100 bg-white">
        {(zones ?? []).length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">Aucune zone : importez le fichier de l&apos;exploitant ci-dessous.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Zone</th>
                <th className="px-4 py-2.5 text-right font-medium">Sites</th>
                <th className="px-4 py-2.5 font-medium">Responsable (FME)</th>
                <th className="px-4 py-2.5 font-medium">Téléphone</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(zones ?? []).map((z) => (
                <tr key={z.id}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{z.nom}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtNumber(z.nbSites)}</td>
                  <td className="px-4 py-2">
                    <select
                      value={z.responsable?.id ?? ''}
                      onChange={(e) => changerFme.mutate({ id: z.id, responsableContactId: e.target.value || null })}
                      className="w-full max-w-xs rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-[rgb(var(--brand-light))]"
                    >
                      <option value="">Aucun responsable</option>
                      {actifs.map((c) => <option key={c.id} value={c.id}>{c.nom} {c.prenom} · {c.societe}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{z.responsable?.telephone ?? '-'}</td>
                  <td className="px-2 py-2.5">
                    <button type="button" title="Supprimer la zone"
                      onClick={() => { if (confirm(`Supprimer la zone « ${z.nom} » ? Ses ${z.nbSites} site(s) deviendront sans zone.`)) supprimer.mutate(z.id); }}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-800">Importer le fichier des zones</h2>
        <p className="mb-3 text-xs text-gray-500">
          Colonnes attendues : SITENAME, ACTIF MAINTENANCE AREA, FME NAME. Un aperçu est affiché d&apos;abord : rien n&apos;est
          enregistré avant « Appliquer ». Les sites sont reconnus par leur nom (majuscules, accents et tirets ignorés), les FME
          parmi les contacts SMS. Un site du parc absent du fichier garde sa zone.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fichierRef} type="file" accept=".xlsx" className="hidden"
            onChange={(e) => { setFichier(e.target.files?.[0] ?? null); setApercu(null); setMessage(null); }} />
          <Button type="button" variant="secondary" icon={FileSpreadsheet} onClick={() => fichierRef.current?.click()}>
            {fichier ? fichier.name : 'Choisir le fichier Excel'}
          </Button>
          <Button type="button" icon={Upload} disabled={!fichier} loading={importer.isPending && importer.variables === false}
            onClick={() => importer.mutate(false)}>
            Aperçu
          </Button>
          {apercu && !apercu.applique && (
            <Button type="button" loading={importer.isPending && importer.variables === true}
              onClick={() => { if (confirm(`Rattacher ${apercu.affectations} site(s) à leur zone ?`)) importer.mutate(true); }}>
              Appliquer
            </Button>
          )}
        </div>

        {apercu && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Sites à rattacher', apercu.affectations, 'text-gray-800'],
                ['Déjà dans la bonne zone', apercu.inchanges, 'text-gray-800'],
                ['Inconnus de la plateforme', apercu.sitesInconnus.length + apercu.sitesAmbigus.length, apercu.sitesInconnus.length + apercu.sitesAmbigus.length ? 'text-amber-700' : 'text-gray-800'],
                ['Sites du parc hors fichier', sansZone ?? 0, sansZone ? 'text-amber-700' : 'text-gray-800'],
              ].map(([l, v, c]) => (
                <div key={l as string} className="rounded-lg border border-gray-100 p-3">
                  <p className={`text-xl font-semibold tabular-nums ${c}`}>{fmtNumber(v as number)}</p>
                  <p className="text-xs text-gray-500">{l}</p>
                </div>
              ))}
            </div>

            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="py-1.5 font-medium">Zone</th>
                  <th className="py-1.5 text-right font-medium">Sites</th>
                  <th className="py-1.5 pl-4 font-medium">FME du fichier</th>
                  <th className="py-1.5 font-medium">Contact SMS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {apercu.zones.map((z) => (
                  <tr key={z.nom}>
                    <td className="py-1.5 font-medium text-gray-800">{z.nom}{z.nouvelle && <span className="ml-2 text-xs font-normal text-[rgb(var(--brand-light))]">nouvelle</span>}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtNumber(z.nbSites)}</td>
                    <td className="py-1.5 pl-4 text-gray-600">{z.fme || '-'}</td>
                    <td className="py-1.5">
                      {z.contact
                        ? <span className="text-green-700">{z.contact.nom} {z.contact.prenom} · {z.contact.telephone}</span>
                        : z.fmeProbleme === 'AMBIGU'
                          ? <span className="text-amber-700">plusieurs contacts portent ce nom : à choisir dans la liste après l&apos;import</span>
                          : z.fme
                            ? <span className="text-amber-700">introuvable dans les contacts SMS : à choisir après l&apos;import</span>
                            : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-2">
              <Liste titre="Sites du fichier inconnus de la plateforme" nb={apercu.sitesInconnus.length}
                aide="Nouveaux sites, ou nom écrit autrement que sur la fiche : corrigez le fichier ou la fiche, puis réimportez."
                onCsv={() => telechargerCsv('zones-sites-inconnus.csv', ['Ligne', 'Site (fichier)', 'Zone'], apercu.sitesInconnus.map((s) => [s.ligne, s.site, s.zone]))}>
                <ul className="space-y-0.5">{apercu.sitesInconnus.map((s) => <li key={s.ligne}><span className="text-gray-400">l.{s.ligne}</span> {s.site} <span className="text-gray-400">→ {s.zone}</span></li>)}</ul>
              </Liste>
              <Liste titre="Noms ambigus" nb={apercu.sitesAmbigus.length}
                aide="Ce nom désigne plusieurs sites de la plateforme : rien n'a été deviné."
                onCsv={() => telechargerCsv('zones-sites-ambigus.csv', ['Ligne', 'Site (fichier)', 'Sites possibles'], apercu.sitesAmbigus.map((s) => [s.ligne, s.site, s.candidats.join(' / ')]))}>
                <ul className="space-y-0.5">{apercu.sitesAmbigus.map((s) => <li key={s.ligne}>{s.site} <span className="text-gray-400">: {s.candidats.join(', ')}</span></li>)}</ul>
              </Liste>
              <Liste titre="Sites listés dans deux zones" nb={apercu.contradictions.length}
                aide="Le fichier se contredit : ces sites ne sont pas rattachés.">
                <ul className="space-y-0.5">{apercu.contradictions.map((s) => <li key={s.site}>{s.site} <span className="text-gray-400">: {s.zones.join(' / ')}</span></li>)}</ul>
              </Liste>
              <Liste titre="Changements de zone" nb={apercu.changementsDeZone.length}
                aide="Sites déjà rattachés à une autre zone : ils changeront.">
                <ul className="space-y-0.5">{apercu.changementsDeZone.map((s) => <li key={s.site}>{s.site} <span className="text-gray-400">: {s.avant} → {s.apres}</span></li>)}</ul>
              </Liste>
              <Liste titre="Sites du parc absents du fichier" nb={apercu.sitesAbsents.length}
                aide="Sites actifs de la plateforme que le fichier ne cite pas : ils restent sans zone (ou gardent la leur), donc sans FME."
                onCsv={() => telechargerCsv('zones-sites-absents-du-fichier.csv', ['Site', 'Région', 'Zone actuelle'], apercu.sitesAbsents.map((s) => [s.nom, s.region, s.zoneActuelle ?? '']))}>
                <ul className="space-y-0.5">{apercu.sitesAbsents.map((s) => <li key={s.nom}>{s.nom} <span className="text-gray-400">· {s.region}{s.zoneActuelle ? ` · ${s.zoneActuelle}` : ''}</span></li>)}</ul>
              </Liste>
            </div>
          </div>
        )}
      </section>

      <p className="mt-3 text-xs text-gray-400">
        Alertes SMS : un FME ne reçoit les incidents, coupures et démarrages ou clôtures que pour les sites de sa zone
        (paramètre « SMS des FME limités aux sites de leur zone »). Les autres contacts ne changent pas.
      </p>
    </div>
  );
}
