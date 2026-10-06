'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, History, Play, Search, ShieldCheck, Table2 } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/toast';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { fmtNumber } from '@/lib/utils';

interface Resultat {
  colonnes: string[];
  lignes: unknown[][];
  nbLignes: number;
  tronque: boolean;
  dureeMs: number;
}
interface ColonneSchema { table: string; colonne: string; type: string }

/** Requêtes de départ, sur le vrai schéma : de quoi voir la forme d'une requête utile. */
const EXEMPLES: Array<{ titre: string; sql: string }> = [
  {
    titre: 'Sites par région et configuration d’énergie',
    sql: `select region, power_config, count(*) as sites
from sites
where is_active
group by region, power_config
order by region, sites desc`,
  },
  {
    titre: 'Interventions terminées ce mois, par prestataire',
    sql: `select p.nom as prestataire, m.type, count(*) as interventions
from maintenances m
left join prestataires p on p.id = m.prestataire_id
where m.statut = 'TERMINEE'
  and m.date_fin >= date_trunc('month', now())
group by p.nom, m.type
order by interventions desc`,
  },
  {
    titre: 'Gasoil livré sur 30 jours, par site',
    sql: `select s.nom as site, s.region, count(*) as livraisons, sum(d.volume_litres) as litres
from depotages d
join sites s on s.id = d.site_id
where d.date_depotage >= now() - interval '30 days'
group by s.nom, s.region
order by litres desc`,
  },
  {
    titre: 'Techniciens sans téléphone lié',
    sql: `select email, app_version, last_login_at
from users
where role in ('TECHNICIEN', 'TRANSPORTEUR')
  and is_active
  and appareil_id is null
order by app_version nulls first, email`,
  },
];

const CLE_HISTORIQUE = 'console-sql-historique';
const HISTORIQUE_MAX = 15;

/** Historique propre à CE navigateur : une commodité, jamais une donnée à garder. */
function lireHistorique(): string[] {
  try { return JSON.parse(localStorage.getItem(CLE_HISTORIQUE) ?? '[]') as string[]; } catch { return []; }
}
function ecrireHistorique(h: string[]) {
  try { localStorage.setItem(CLE_HISTORIQUE, JSON.stringify(h.slice(0, HISTORIQUE_MAX))); } catch { /* stockage indisponible */ }
}

/** CSV au format d'Excel en français : point-virgule, BOM UTF-8. */
function telechargerCsv(r: Resultat) {
  const cellule = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lignes = [r.colonnes.map(cellule).join(';'), ...r.lignes.map((l) => l.map(cellule).join(';'))];
  const blob = new Blob(['﻿' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date();
  const horo = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `console-sql-${horo}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Console SQL - LECTURE SEULE.
 *
 * Les requêtes s'exécutent sous un rôle PostgreSQL qui ne peut que lire, sans
 * les colonnes sensibles des comptes, dans une transaction en lecture seule
 * bornée à 15 s et 1 000 lignes. Chaque exécution est tracée au journal d'audit.
 */
export default function ConsoleSqlPage() {
  const [sql, setSql] = useState(EXEMPLES[0].sql);
  const [historique, setHistorique] = useState<string[]>([]);
  const [voirHistorique, setVoirHistorique] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const editeur = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setHistorique(lireHistorique()); }, []);

  const { data: schema } = useQuery({
    queryKey: ['console-sql-schema'],
    queryFn: () => api.get('/admin/db/sql/schema').then((r) => r.data.data as ColonneSchema[]),
    staleTime: 10 * 60_000,
  });

  const tables = useMemo(() => {
    const parTable = new Map<string, ColonneSchema[]>();
    for (const c of schema ?? []) parTable.set(c.table, [...(parTable.get(c.table) ?? []), c]);
    const t = recherche.trim().toLowerCase();
    return [...parTable.entries()].filter(([nom, cols]) =>
      !t || nom.includes(t) || cols.some((c) => c.colonne.includes(t)));
  }, [schema, recherche]);

  const executer = useMutation({
    mutationFn: (requete: string) => api.post('/admin/db/sql', { requete }).then((r) => r.data.data as Resultat),
    onSuccess: (_r, requete) => {
      const h = [requete.trim(), ...lireHistorique().filter((x) => x !== requete.trim())];
      ecrireHistorique(h);
      setHistorique(h.slice(0, HISTORIQUE_MAX));
    },
  });

  const lancer = () => { if (sql.trim() && !executer.isPending) executer.mutate(sql); };

  /** Insère un nom (table, colonne) au curseur de l'éditeur. */
  const inserer = (texte: string) => {
    const el = editeur.current;
    if (!el) { setSql((s) => s + texte); return; }
    const debut = el.selectionStart ?? sql.length;
    const fin = el.selectionEnd ?? sql.length;
    const suivant = sql.slice(0, debut) + texte + sql.slice(fin);
    setSql(suivant);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(debut + texte.length, debut + texte.length); });
  };

  const r = executer.data;

  return (
    <div>
      <PageHeader
        title="Requête SQL"
        subtitle="Console de lecture sur la base de l'application"
        backHref="/administration/base-de-donnees"
      />

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
        <ShieldCheck size={15} className="mt-0.5 shrink-0" />
        <span>
          <b>Lecture seule, garantie par la base</b> : aucune écriture n&apos;est possible, quelle que soit la requête.
          15 secondes et 1 000 lignes au plus. L&apos;empreinte des mots de passe et les jetons de notification ne sont pas lisibles.
          Chaque requête est tracée dans le journal d&apos;audit.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <div className="rounded-xl border border-gray-100 bg-white p-3">
            <textarea
              ref={editeur}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); lancer(); }
                // Tabulation : indenter plutôt que quitter l'éditeur.
                if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); inserer('  '); }
              }}
              spellCheck={false}
              rows={10}
              className="w-full resize-y rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[13px] leading-relaxed text-gray-800 outline-none focus:border-[rgb(var(--brand-light))] focus:bg-white"
              placeholder="select …"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button icon={Play} loading={executer.isPending} onClick={lancer} disabled={!sql.trim()}>Exécuter</Button>
              <span className="text-xs text-gray-400">Ctrl / ⌘ + Entrée</span>
              <select
                value=""
                onChange={(e) => { const ex = EXEMPLES[Number(e.target.value)]; if (ex) setSql(ex.sql); }}
                className="ml-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
              >
                <option value="">Exemples…</option>
                {EXEMPLES.map((ex, i) => <option key={ex.titre} value={i}>{ex.titre}</option>)}
              </select>
              <div className="relative">
                <button type="button" onClick={() => setVoirHistorique((v) => !v)} disabled={!historique.length}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  <History size={14} /> Historique
                </button>
                {voirHistorique && historique.length > 0 && (
                  <div className="absolute right-0 z-20 mt-1 max-h-80 w-[28rem] overflow-y-auto rounded-xl border border-gray-100 bg-white p-1 shadow-lg">
                    {historique.map((h) => (
                      <button key={h} type="button" onClick={() => { setSql(h); setVoirHistorique(false); }}
                        className="block w-full truncate rounded-lg px-3 py-2 text-left font-mono text-xs text-gray-700 hover:bg-gray-50" title={h}>
                        {h.replace(/\s+/g, ' ')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {executer.isError && (
            <div className="mt-3 whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-mono text-xs text-red-800">
              {errorMessage(executer.error, 'Requête refusée')}
            </div>
          )}

          {r && !executer.isError && (
            <div className="mt-3 rounded-xl border border-gray-100 bg-white">
              <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
                <span><b className="text-gray-800">{fmtNumber(r.nbLignes)}</b> ligne{r.nbLignes > 1 ? 's' : ''}</span>
                <span>{r.dureeMs} ms</span>
                {r.tronque && <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700">Limité aux 1 000 premières lignes</span>}
                {r.nbLignes > 0 && (
                  <button type="button" onClick={() => telechargerCsv(r)}
                    className="ml-auto inline-flex items-center gap-1.5 font-medium text-[rgb(var(--brand-light))] hover:underline">
                    <Download size={13} /> CSV
                  </button>
                )}
              </div>
              {r.nbLignes === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-gray-400">Aucune ligne.</p>
              ) : (
                <div className="max-h-[60vh] overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        {r.colonnes.map((c, i) => (
                          <th key={i} className="whitespace-nowrap border-b border-gray-100 px-3 py-2 text-left font-semibold text-gray-600">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.lignes.map((l, i) => (
                        <tr key={i} className="odd:bg-white even:bg-gray-50/50 hover:bg-[rgb(var(--brand-light)/0.04)]">
                          {l.map((v, j) => (
                            <td key={j} className="max-w-[320px] truncate border-b border-gray-50 px-3 py-1.5 font-mono text-gray-700" title={v == null ? 'NULL' : String(v)}>
                              {v == null ? <span className="italic text-gray-300">NULL</span> : String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Schéma LISIBLE par la console : les colonnes protégées n'y figurent pas. */}
        <aside className="rounded-xl border border-gray-100 bg-white p-3 xl:max-h-[calc(100vh-14rem)] xl:overflow-y-auto">
          <p className="mb-2 text-xs font-semibold text-gray-600">Tables et colonnes</p>
          <div className="relative mb-2">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Table ou colonne…"
              className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[rgb(var(--brand-light))]" />
          </div>
          <p className="mb-2 text-[11px] text-gray-400">Clic sur un nom : il s&apos;insère au curseur.</p>
          {tables.map(([table, cols]) => {
            const ouverte = ouvertes.has(table) || !!recherche.trim();
            return (
              <div key={table} className="mb-0.5">
                <div className="flex items-center gap-1">
                  <button type="button" className="p-0.5 text-gray-400"
                    onClick={() => setOuvertes((o) => { const n = new Set(o); if (n.has(table)) n.delete(table); else n.add(table); return n; })}>
                    {ouverte ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <button type="button" onClick={() => inserer(table)}
                    className="flex min-w-0 items-center gap-1.5 truncate rounded px-1 py-0.5 font-mono text-xs text-gray-800 hover:bg-gray-100">
                    <Table2 size={12} className="shrink-0 text-gray-400" /> {table}
                  </button>
                </div>
                {ouverte && (
                  <div className="ml-6 border-l border-gray-100 pl-2">
                    {cols.map((c) => (
                      <button key={c.colonne} type="button" onClick={() => inserer(c.colonne)}
                        className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-gray-100">
                        <span className="truncate font-mono text-[11px] text-gray-700">{c.colonne}</span>
                        <span className="shrink-0 text-[10px] text-gray-400">{c.type}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
