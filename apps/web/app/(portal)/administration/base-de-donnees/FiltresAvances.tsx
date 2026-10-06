'use client';

import { useMemo, useState } from 'react';
import { Filter, Plus, X } from 'lucide-react';
import { ChampMeta, Operateur, TableMeta } from './types';
import { SelecteurRelation } from './SelecteurRelation';

export interface FiltreActif {
  id: string;
  champ: string;
  op: Operateur;
  valeur: string;
  /** Ce qu'on affiche à la place d'un identifiant (nom du site plutôt que son uuid). */
  libelle?: string;
}

const NUMERIQUES = new Set(['Int', 'Float', 'Decimal', 'BigInt']);

/** Libellé d'un opérateur, dans les mots du type de la colonne. */
function libelleOp(op: Operateur, champ: ChampMeta): string {
  const date = champ.type === 'DateTime';
  const nombre = NUMERIQUES.has(champ.type);
  switch (op) {
    case 'eq': return champ.kind === 'enum' || champ.type === 'Boolean' || champ.fkVers ? 'est' : date ? 'le' : nombre ? '=' : 'est égal à';
    case 'ne': return champ.kind === 'enum' || champ.fkVers ? "n'est pas" : date ? 'autre jour que' : nombre ? '≠' : 'est différent de';
    case 'contient': return 'contient';
    case 'commence': return 'commence par';
    case 'gt': return date ? 'après le' : '>';
    case 'gte': return date ? 'à partir du' : '≥';
    case 'lt': return date ? 'avant le' : '<';
    case 'lte': return date ? "jusqu'au" : '≤';
    case 'in': return 'est parmi';
    case 'vide': return 'est vide';
    case 'nonvide': return "n'est pas vide";
  }
}

const sansValeur = (op: Operateur) => op === 'vide' || op === 'nonvide';

const fmtJour = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v);

/** Étiquette d'un filtre actif : « dateFin jusqu'au 30/09/2026 ». */
function etiquette(f: FiltreActif, champ: ChampMeta | undefined): string {
  if (!champ) return `${f.champ} ${f.op} ${f.valeur}`;
  const op = libelleOp(f.op, champ);
  if (sansValeur(f.op)) return `${champ.nom} ${op}`;
  const v = f.libelle
    ?? (champ.type === 'Boolean' ? (f.valeur === 'true' ? 'oui' : 'non')
      : champ.type === 'DateTime' ? fmtJour(f.valeur)
        : f.valeur.split(',').join(', '));
  return `${champ.nom} ${op} ${v}`;
}

/** Paramètres de requête des filtres : f_<colonne>__<opérateur>=valeur, répétables. */
export function parametresFiltres(filtres: FiltreActif[], dans: URLSearchParams): void {
  for (const f of filtres) dans.append(`f_${f.champ}__${f.op}`, sansValeur(f.op) ? '1' : f.valeur);
}

const champSaisie =
  'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[rgb(var(--brand-light))]';

/**
 * Filtres de la console base de données : une colonne, un opérateur, une valeur.
 *
 * Les opérateurs proposés sont ceux que l'API annonce pour la colonne
 * (`operateurs` du catalogue) : l'écran ne permet pas de construire un filtre
 * que le serveur refuserait. Plusieurs filtres se combinent par ET - c'est ce
 * qui donne une période (« à partir du 1er » ET « jusqu'au 30 »).
 */
export function FiltresAvances({
  meta,
  filtres,
  onChange,
}: {
  meta: TableMeta;
  filtres: FiltreActif[];
  onChange: (f: FiltreActif[]) => void;
}) {
  const champs = useMemo(() => meta.champs.filter((c) => (c.operateurs ?? []).length > 0), [meta]);
  const [ouvert, setOuvert] = useState(false);
  const [nomChamp, setNomChamp] = useState('');
  const [op, setOp] = useState<Operateur | ''>('');
  const [valeur, setValeur] = useState('');
  const [libelle, setLibelle] = useState<string | undefined>();
  const [valeursIn, setValeursIn] = useState<string[]>([]);

  const champ = champs.find((c) => c.nom === nomChamp);
  const operateurs = champ?.operateurs ?? [];

  const choisirChamp = (nom: string) => {
    setNomChamp(nom);
    const c = champs.find((x) => x.nom === nom);
    setOp(c?.operateurs?.[0] ?? '');
    setValeur(''); setLibelle(undefined); setValeursIn([]);
  };
  const reinitialiser = () => { setOuvert(false); setNomChamp(''); setOp(''); setValeur(''); setLibelle(undefined); setValeursIn([]); };

  const valeurFinale = op === 'in' ? valeursIn.join(',') : valeur.trim();
  const pret = !!champ && !!op && (sansValeur(op as Operateur) || valeurFinale !== '');

  const ajouter = () => {
    if (!pret || !champ || !op) return;
    onChange([...filtres, { id: `${Date.now()}-${Math.random()}`, champ: champ.nom, op, valeur: valeurFinale, libelle }]);
    reinitialiser();
  };

  /** Le champ de saisie adapté au type de la colonne et à l'opérateur. */
  const saisie = () => {
    if (!champ || !op || sansValeur(op)) return null;
    if (champ.kind === 'enum') {
      const valeurs = meta.enums[champ.type] ?? [];
      if (op === 'in') {
        return (
          <div className="flex max-w-xl flex-wrap gap-1.5">
            {valeurs.map((v) => (
              <label key={v} className={`cursor-pointer rounded-md border px-2 py-1 text-xs ${valeursIn.includes(v) ? 'border-[rgb(var(--brand-light))] bg-[rgb(var(--brand-light)/0.08)] text-gray-800' : 'border-gray-200 text-gray-500'}`}>
                <input type="checkbox" className="sr-only" checked={valeursIn.includes(v)}
                  onChange={(e) => setValeursIn((p) => (e.target.checked ? [...p, v] : p.filter((x) => x !== v)))} />
                {v}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select value={valeur} onChange={(e) => setValeur(e.target.value)} className={champSaisie}>
          <option value="">Choisir…</option>
          {valeurs.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    }
    if (champ.type === 'Boolean') {
      return (
        <select value={valeur} onChange={(e) => setValeur(e.target.value)} className={champSaisie}>
          <option value="">Choisir…</option>
          <option value="true">Oui</option>
          <option value="false">Non</option>
        </select>
      );
    }
    if (champ.fkVers) {
      return (
        <div className="w-72">
          <SelecteurRelation modeleCible={champ.fkVers} valeur={valeur} libelleActuel={libelle}
            onChange={(v, l) => { setValeur(v); setLibelle(l); }} />
        </div>
      );
    }
    if (champ.type === 'DateTime') {
      return <input type="date" value={valeur} onChange={(e) => setValeur(e.target.value)} className={champSaisie} />;
    }
    return (
      <input value={valeur} onChange={(e) => setValeur(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') ajouter(); }}
        inputMode={NUMERIQUES.has(champ.type) ? 'decimal' : undefined}
        placeholder={NUMERIQUES.has(champ.type) ? 'Nombre' : 'Valeur'} className={`${champSaisie} w-56`} />
    );
  };

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {filtres.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--brand-light)/0.3)] bg-[rgb(var(--brand-light)/0.06)] py-1 pl-3 pr-1.5 text-xs text-gray-700">
            {etiquette(f, meta.champs.find((c) => c.nom === f.champ))}
            <button type="button" onClick={() => onChange(filtres.filter((x) => x.id !== f.id))}
              className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700" title="Retirer ce filtre">
              <X size={12} />
            </button>
          </span>
        ))}
        {!ouvert && (
          <button type="button" onClick={() => setOuvert(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-400 hover:bg-gray-50">
            <Plus size={13} /> Ajouter un filtre
          </button>
        )}
        {filtres.length > 0 && !ouvert && (
          <button type="button" onClick={() => onChange([])} className="text-xs font-medium text-[rgb(var(--brand-light))] hover:underline">
            Retirer tous les filtres
          </button>
        )}
      </div>

      {ouvert && (
        <div className="mt-2 flex flex-wrap items-start gap-2 rounded-xl border border-gray-100 bg-white p-3">
          <Filter size={15} className="mt-2.5 text-gray-400" />
          <select value={nomChamp} onChange={(e) => choisirChamp(e.target.value)} className={champSaisie} autoFocus>
            <option value="">Colonne…</option>
            {champs.map((c) => <option key={c.nom} value={c.nom}>{c.nom}</option>)}
          </select>
          {champ && (
            <select value={op} onChange={(e) => { setOp(e.target.value as Operateur); setValeur(''); setLibelle(undefined); setValeursIn([]); }} className={champSaisie}>
              {operateurs.map((o) => <option key={o} value={o}>{libelleOp(o, champ)}</option>)}
            </select>
          )}
          {saisie()}
          <button type="button" disabled={!pret} onClick={ajouter}
            className="rounded-lg bg-[rgb(var(--brand))] px-3 py-2 text-sm font-medium text-white hover:bg-[rgb(var(--brand-light))] disabled:cursor-not-allowed disabled:opacity-50">
            Ajouter
          </button>
          <button type="button" onClick={reinitialiser} className="px-2 py-2 text-sm text-gray-500 hover:text-gray-800">Annuler</button>
        </div>
      )}
    </div>
  );
}
